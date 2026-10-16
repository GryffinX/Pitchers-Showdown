// Integration tests. Run: npm test
// Uses an in-memory MongoDB by default. To use a real cluster instead, set TEST_DATABASE_URL:
// a fresh, randomly named database is created there and dropped afterwards. Never point it at production.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const ADMIN_PASSWORD = 'correct horse battery staple';
process.env.JWT_SECRET = 'test-player-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 4);
process.env.ADMIN_JWT_SECRET = 'test-admin-secret';
delete process.env.ALLOW_PUBLIC_REGISTRATION;
delete process.env.CORS_ORIGINS;

const app = require('../app');
const { User } = require('../models/user');
const { Investment } = require('../models/pitcher');

let mongo, server, base, adminToken;

const call = async (method, path, { body, token, playerToken } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (playerToken) headers['x-access-token'] = playerToken;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};

const playerLogin = (username, password) => call('POST', '/api/auth/login', { body: { username, password } });

before(async () => {
    if (process.env.TEST_DATABASE_URL) {
        await mongoose.connect(process.env.TEST_DATABASE_URL, { dbName: `pitchers_test_${crypto.randomBytes(4).toString('hex')}` });
    } else {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        mongo = await MongoMemoryServer.create();
        await mongoose.connect(mongo.getUri());
    }
    await User.syncIndexes();
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;

    // An account created the old way (no deletedAt field), like existing production data
    await User.collection.insertOne({
        username: 'legacy', name: 'Legacy Team', password: bcrypt.hashSync('password', 5), Rbalance: 7000, desc: ' ', ppt: ' ',
    });
});

after(async () => {
    server.close();
    if (!mongo) {
        assert.match(mongoose.connection.name, /^pitchers_test_[0-9a-f]{8}$/, 'refusing to drop a non-test database');
        await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});

test('existing player login and profile still work', async () => {
    const login = await playerLogin('legacy', 'password');
    assert.equal(login.status, 200);
    assert.equal(login.body.balance, 7000);

    const profile = await call('GET', '/api/profile', { playerToken: login.body.jwtToken });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.name, 'Legacy Team');

    const teams = await call('GET', '/api/business');
    assert.deepEqual(teams.body.teams.map(t => t.team_name), ['Legacy Team']);
});

test('invalid player token returns 401, not 500', async () => {
    const res = await call('GET', '/api/profile', { playerToken: 'not-a-jwt' });
    assert.equal(res.status, 401);
});

test('admin login rejects bad credentials', async () => {
    const wrongPass = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'nope' } });
    assert.equal(wrongPass.status, 401);
    const wrongUser = await call('POST', '/api/admin/login', { body: { username: 'legacy', password: 'password' } });
    assert.equal(wrongUser.status, 401);
    const injection = await call('POST', '/api/admin/login', { body: { username: { $ne: null }, password: 'x' } });
    assert.equal(injection.status, 400);
});

test('admin login succeeds and /me validates the session', async () => {
    const res = await call('POST', '/api/admin/login', { body: { username: 'admin', password: ADMIN_PASSWORD } });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.ok(!JSON.stringify(res.body).includes(process.env.ADMIN_PASSWORD_HASH));
    adminToken = res.body.token;

    const me = await call('GET', '/api/admin/me', { token: adminToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.admin.username, 'admin');
});

test('admin endpoints reject missing, team, forged and expired tokens', async () => {
    assert.equal((await call('GET', '/api/admin/teams')).status, 401);

    const player = await playerLogin('legacy', 'password');
    assert.equal((await call('GET', '/api/admin/teams', { token: player.body.jwtToken })).status, 401);
    assert.equal((await call('GET', '/api/admin/teams', { playerToken: player.body.jwtToken })).status, 401);

    // Right claims but signed with the player secret
    const forged = jwt.sign({ role: 'admin', jti: 'x' }, process.env.JWT_SECRET, { subject: 'admin', audience: 'pitchers-showdown-admin' });
    assert.equal((await call('GET', '/api/admin/teams', { token: forged })).status, 401);

    const expired = jwt.sign({ role: 'admin', jti: 'x' }, process.env.ADMIN_JWT_SECRET, { subject: 'admin', audience: 'pitchers-showdown-admin', expiresIn: -10 });
    const res = await call('GET', '/api/admin/teams', { token: expired });
    assert.equal(res.status, 401);
    assert.match(res.body.error, /expired/);
});

test('admin creates a team that can log in; duplicates and bad input are rejected', async () => {
    const created = await call('POST', '/api/admin/teams', { token: adminToken, body: { username: 'alpha', password: 'secret123', name: 'Alpha' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.balance, 7000);
    assert.equal(created.body.team.password, undefined);

    const stored = await User.findOne({ username: 'alpha' });
    assert.ok(stored.password.startsWith('$2'), 'password is stored as a bcrypt hash');

    const login = await playerLogin('alpha', 'secret123');
    assert.equal(login.status, 200);

    const dup = await call('POST', '/api/admin/teams', { token: adminToken, body: { username: 'alpha', password: 'secret123', name: 'Other' } });
    assert.equal(dup.status, 409);

    const bad = await call('POST', '/api/admin/teams', { token: adminToken, body: { username: 'a', password: '1', name: '' } });
    assert.equal(bad.status, 400);
});

test('admin-created team logs in with its username as shown, any letter case or stray spaces', async () => {
    const created = await call('POST', '/api/admin/teams', { token: adminToken, body: { username: 'Mixed.Case', password: 'Pa55word', name: 'Mixed Case' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.team.username, 'Mixed.Case');
    const stored = await User.findOne({ username: 'Mixed.Case' }).lean();
    assert.ok(/^\$2[aby]\$\d\d\$.{53}$/.test(stored.password), 'stored once as a bcrypt hash');
    assert.equal(stored.Rbalance, 7000);
    assert.equal(stored.deletedAt, null);

    for (const username of ['Mixed.Case', 'mixed.case', 'MIXED.CASE', ' Mixed.Case ', 'Mixed.Case\t'])
        assert.equal((await playerLogin(username, 'Pa55word')).status, 200, `"${username}" should log in`);
    for (const [username, password] of [['Mixed.Case', 'pa55word'], ['mixed.case', 'wrong'], ['@Mixed.Case', 'Pa55word'], ['MixedxCase', 'Pa55word'], ['Mixed', 'Pa55word'], ['   ', 'Pa55word']])
        assert.equal((await playerLogin(username, password)).status, 401, `"${username}" / wrong input should fail`);

    const caseDup = await call('POST', '/api/admin/teams', { token: adminToken, body: { username: 'mixed.CASE', password: 'Pa55word', name: 'Copy' } });
    assert.equal(caseDup.status, 409);

    // Older data may already hold usernames that differ only by case: exact matches still work, guesses don't
    await User.collection.insertMany([
        { username: 'twin', name: 'Twin 1', password: bcrypt.hashSync('password', 5), Rbalance: 7000, desc: ' ', ppt: ' ' },
        { username: 'Twin', name: 'Twin 2', password: bcrypt.hashSync('password', 5), Rbalance: 7000, desc: ' ', ppt: ' ' },
    ]);
    assert.equal((await playerLogin('twin', 'password')).status, 200);
    assert.equal((await playerLogin('Twin', 'password')).status, 200);
    assert.equal((await playerLogin('TWIN', 'password')).status, 401);
    await User.deleteMany({ username: { $in: ['twin', 'Twin', 'Mixed.Case'] } });
});

test('team list supports search and pagination without exposing secrets', async () => {
    for (const n of [1, 2, 3]) {
        await call('POST', '/api/admin/teams', { token: adminToken, body: { username: `bulk${n}`, password: 'password', name: `Bulk ${n}` } });
    }
    const page = await call('GET', '/api/admin/teams?limit=2&page=1&sort=username&order=asc', { token: adminToken });
    assert.equal(page.status, 200);
    assert.equal(page.body.total, 5);
    assert.equal(page.body.pages, 3);
    assert.deepEqual(page.body.teams.map(t => t.username), ['alpha', 'bulk1']);
    for (const team of page.body.teams) {
        assert.equal(team.password, undefined);
        assert.equal(team.desc, undefined);
    }

    const search = await call('GET', '/api/admin/teams?q=BULK%202', { token: adminToken });
    assert.deepEqual(search.body.teams.map(t => t.username), ['bulk2']);

    const regex = await call('GET', '/api/admin/teams?q=.*', { token: adminToken });
    assert.equal(regex.body.total, 0, 'search input is treated literally');
});

test('rename works and other fields cannot be mass-assigned', async () => {
    const alpha = await User.findOne({ username: 'alpha' });

    const renamed = await call('PATCH', `/api/admin/teams/${alpha._id}`, { token: adminToken, body: { name: 'Alpha Prime' } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.team.name, 'Alpha Prime');

    const sneaky = await call('PATCH', `/api/admin/teams/${alpha._id}`, { token: adminToken, body: { name: 'X', Rbalance: 999999 } });
    assert.equal(sneaky.status, 400);
    assert.equal((await User.findById(alpha._id)).Rbalance, 7000);

    assert.equal((await call('PATCH', '/api/admin/teams/not-an-id', { token: adminToken, body: { name: 'X' } })).status, 400);
    assert.equal((await call('PATCH', `/api/admin/teams/${new mongoose.Types.ObjectId()}`, { token: adminToken, body: { name: 'X' } })).status, 404);
});

test('password reset rehashes and signs the team out', async () => {
    const alpha = await User.findOne({ username: 'alpha' });
    const session = await playerLogin('alpha', 'secret123');

    const reset = await call('POST', `/api/admin/teams/${alpha._id}/reset-password`, { token: adminToken, body: { password: 'newpass456' } });
    assert.equal(reset.status, 200);
    assert.ok(!JSON.stringify(reset.body).includes('$2'));

    assert.equal((await playerLogin('alpha', 'secret123')).status, 401);
    assert.equal((await playerLogin('alpha', 'newpass456')).status, 200);
    assert.equal((await call('GET', '/api/profile', { playerToken: session.body.jwtToken })).status, 403);
});

test('delete requires confirmation, keeps history, and blocks login and investing', async () => {
    const legacy = await User.findOne({ username: 'legacy' });
    const bulk1 = await User.findOne({ username: 'bulk1' });
    const investor = await playerLogin('legacy', 'password');
    const invest = await call('POST', `/api/business/${bulk1._id}`, { playerToken: investor.body.jwtToken, body: { amt: 500 } });
    assert.equal(invest.status, 200);

    const details = await call('GET', `/api/admin/teams/${legacy._id}`, { token: adminToken });
    assert.equal(details.body.totalInvested, 500);

    const mismatch = await call('DELETE', `/api/admin/teams/${bulk1._id}`, { token: adminToken, body: { confirmUsername: 'legacy' } });
    assert.equal(mismatch.status, 400);

    const deleted = await call('DELETE', `/api/admin/teams/${bulk1._id}`, { token: adminToken, body: { confirmUsername: 'bulk1' } });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.team.status, 'deleted');

    assert.equal((await playerLogin('bulk1', 'password')).status, 401);
    const teams = await call('GET', '/api/business');
    assert.ok(!teams.body.teams.some(t => t.team_name === 'Bulk 1'));
    assert.equal(await Investment.countDocuments({ pitcher: bulk1._id }), 1, 'investment history is preserved');

    const bulk2 = await User.findOne({ username: 'bulk2' });
    const investBulk2 = await playerLogin('bulk2', 'password');
    assert.equal((await call('POST', `/api/business/${bulk1._id}`, { playerToken: investBulk2.body.jwtToken, body: { amt: 10 } })).status, 404);

    const again = await call('DELETE', `/api/admin/teams/${bulk1._id}`, { token: adminToken, body: { confirmUsername: 'bulk1' } });
    assert.equal(again.status, 409);

    const deletedList = await call('GET', '/api/admin/teams?status=deleted', { token: adminToken });
    assert.deepEqual(deletedList.body.teams.map(t => t.username), ['bulk1']);
    assert.ok(bulk2);
});

test('stats reflect the database', async () => {
    const res = await call('GET', '/api/admin/stats', { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.activeTeams, 4);
    assert.equal(res.body.deletedTeams, 1);
    assert.equal(res.body.totalInvested, 500);
    assert.equal(res.body.investmentCount, 1);
    assert.equal(res.body.teamsThatInvested, 1);
    assert.equal(res.body.startingBalance, 7000);
});

test('investing validates the amount and cannot overspend with parallel requests', async () => {
    const investor = await User.findOne({ username: 'bulk2' });
    const [teamA, teamB] = await User.find({ deletedAt: null, _id: { $ne: investor._id } }).limit(2);
    const { body: { jwtToken } } = await playerLogin('bulk2', 'password');
    const invest = (team, amt) => call('POST', `/api/business/${team}`, { playerToken: jwtToken, body: { amt } });

    for (const amt of ['100', -5, 0, null, undefined, 1e400])
        assert.equal((await invest(teamA._id, amt)).status, 400, `amount ${amt} should be rejected`);
    assert.equal((await invest('not-an-id', 100)).status, 404);
    assert.equal((await call('GET', '/api/business/not-an-id')).status, 404);

    const results = await Promise.all([invest(teamA._id, 4000), invest(teamB._id, 4000)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    assert.equal((await User.findById(investor._id)).Rbalance, 3000);
    assert.equal(await Investment.countDocuments({ user: investor._id }), 1);
});

test('health check reports database readiness', async () => {
    const res = await call('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok', database: 'connected' });
});

test('profile names the other team for investments made, never who invested in them', async () => {
    // An old account saved without a name, like the legacy "test" record in real data
    const { insertedId: namelessId } = await User.collection.insertOne({
        username: 'nameless', password: bcrypt.hashSync('password', 5), Rbalance: 7000, desc: ' ', ppt: ' ',
    });
    const one = await new User({ username: 'prof1', name: 'Prof One', password: 'password', desc: ' ', ppt: ' ' }).save();
    const two = await new User({ username: 'prof2', name: 'Prof Two', password: 'password', desc: ' ', ppt: ' ' }).save();
    const t1 = (await playerLogin('prof1', 'password')).body.jwtToken;
    const t2 = (await playerLogin('prof2', 'password')).body.jwtToken;
    const invest = (token, team, amt) => call('POST', `/api/business/${team}`, { playerToken: token, body: { amt } });

    const made = await invest(t1, namelessId, 300);
    assert.equal(made.status, 200);
    assert.deepEqual(made.body, { message: 'Investment successful', amt: 300, team: 'nameless', balance: 6700 });
    assert.equal((await invest(t2, one._id, 200)).status, 200);

    const tooMuch = await invest(t1, two._id, 999999);
    assert.equal(tooMuch.status, 400);
    assert.equal(tooMuch.body.error, 'Insufficient Balance');
    assert.equal((await User.findById(one._id)).Rbalance, 6700, 'a failed investment changes nothing');

    const listed = await call('GET', '/api/business');
    assert.ok(listed.body.teams.some(t => t.team_name === 'nameless'), 'unnamed teams are listed by username');

    let profile = await call('GET', '/api/profile', { playerToken: t1 });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.balance, 6700);
    assert.deepEqual(profile.body.investments, [{ amt: 300, team: 'nameless', teamDeleted: false }]);
    assert.ok(!/password|\$2[aby]\$|deletedAt|jwt/i.test(JSON.stringify(profile.body)), 'no account secrets in the profile');

    // Players never learn who invested in them or how much
    assert.equal(profile.body.received, undefined);
    assert.ok(!JSON.stringify(profile.body).includes('Prof Two'), 'the investor is not revealed');
    assert.ok(!JSON.stringify(profile.body).includes('200'), 'the amount received is not revealed');

    const empty = await call('GET', '/api/profile', { playerToken: (await playerLogin('nameless', 'password')).body.jwtToken });
    assert.equal(empty.body.name, 'nameless');
    assert.deepEqual(empty.body.investments, []);
    assert.deepEqual(Object.keys(empty.body).sort(), ['balance', 'investments', 'name']);

    // Removing a team you invested in keeps the history, flagged as removed
    await User.updateOne({ _id: namelessId }, { deletedAt: new Date() });
    profile = await call('GET', '/api/profile', { playerToken: t1 });
    assert.deepEqual(profile.body.investments, [{ amt: 300, team: 'nameless', teamDeleted: true }]);

    await Investment.deleteMany({ $or: [{ user: { $in: [one._id, two._id] } }, { pitcher: one._id }] });
    await User.deleteMany({ _id: { $in: [namelessId, one._id, two._id] } });
});

test('admin awards points that can be edited, revoked and restored', async () => {
    const team = await new User({ username: 'pointy', name: 'Pointy', password: 'password', desc: ' ', ppt: ' ' }).save();
    const award = (body) => call('POST', `/api/admin/teams/${team._id}/points`, { token: adminToken, body });
    const edit = (id, body) => call('PATCH', `/api/admin/points/${id}`, { token: adminToken, body });

    const empty = await call('GET', `/api/admin/teams/${team._id}/points`, { token: adminToken });
    assert.equal(empty.status, 200);
    assert.equal(empty.body.total, 0);
    assert.deepEqual(empty.body.awards, []);

    assert.equal((await award({ points: 50, reason: '  Best pitch deck  ' })).status, 201);
    let res = await award({ points: -10, reason: 'Late' });
    assert.equal(res.status, 201);
    assert.equal(res.body.total, 40);
    const [late, best] = res.body.awards; // newest first
    assert.equal(best.reason, 'Best pitch deck');

    // Bad input changes nothing
    for (const body of [{ points: 0 }, { points: 1.5 }, { points: '5' }, { points: 1e6 }, { points: 5, reason: 'x'.repeat(121) }])
        assert.equal((await award(body)).status, 400, JSON.stringify(body));
    assert.equal((await edit(best.id, { team: 'x' })).status, 400);
    assert.equal((await edit(best.id, { revoked: 'yes' })).status, 400);
    assert.equal((await edit('nope', { points: 1 })).status, 400);
    assert.equal((await edit(new mongoose.Types.ObjectId(), { points: 1 })).status, 404);
    assert.equal((await call('POST', `/api/admin/teams/${team._id}/points`, { body: { points: 5 } })).status, 401, 'admin only');

    res = await edit(best.id, { points: 70, reason: 'Best pitch deck (final)' });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 60);

    assert.ok(res.body.awards.find(a => a.id === best.id).editedAt, 'changing the value marks it edited');

    res = await edit(late.id, { revoked: true });
    assert.equal(res.body.total, 70);
    assert.equal(res.body.awards.find(a => a.id === late.id).revoked, true);
    assert.equal(res.body.awards.find(a => a.id === late.id).editedAt, null, 'revoking is not an edit');

    const listed = await call('GET', '/api/admin/teams', { token: adminToken });
    assert.equal(listed.body.teams.find(t => t.username === 'pointy').points, 70);
    assert.equal((await call('GET', `/api/admin/teams/${team._id}`, { token: adminToken })).body.team.points, 70);

    res = await edit(late.id, { revoked: false });
    assert.equal(res.body.total, 60);

    // Deleted teams are read-only
    await User.updateOne({ _id: team._id }, { deletedAt: new Date() });
    assert.equal((await award({ points: 5 })).status, 409);
    assert.equal((await edit(best.id, { points: 1 })).status, 409);

    await User.deleteOne({ _id: team._id });
});

test('admin team list and details show the live score from the leaderboard formula', async () => {
    const teams = [];
    for (const n of [1, 2, 3]) teams.push(await new User({ username: `score${n}`, name: `Score ${n}`, password: 'password', desc: ' ', ppt: ' ' }).save());
    const tokens = [];
    for (const n of [1, 2, 3]) tokens.push((await playerLogin(`score${n}`, 'password')).body.jwtToken);
    const invest = (i, j, amt) => call('POST', `/api/business/${teams[j]._id}`, { playerToken: tokens[i], body: { amt } });
    assert.equal((await invest(0, 1, 1000)).status, 200);
    assert.equal((await invest(0, 2, 500)).status, 200);
    assert.equal((await invest(1, 2, 2000)).status, 200);

    // Independent calculation over everything in the database
    const active = await User.find({ deletedAt: null });
    const all = await Investment.find();
    const ir = {};
    active.forEach(u => { ir[u._id] = 0; });
    all.forEach(inv => { ir[inv.pitcher] = (ir[inv.pitcher] || 0) + inv.amt; });
    const avg = Object.values(ir).reduce((a, b) => a + b, 0) / active.length;
    const pi = {};
    active.forEach(u => { pi[u._id] = 0; });
    all.forEach(inv => { pi[inv.user] = (pi[inv.user] || 0) + inv.amt * ((ir[inv.pitcher] || 0) / avg); });
    const maxIR = Math.max(...Object.values(ir), 1);
    const maxPI = Math.max(...Object.values(pi), 1);
    const expected = (id) => 0.6 * (ir[id] / maxIR) + 0.4 * (pi[id] / maxPI);

    const listed = await call('GET', '/api/admin/teams?q=score', { token: adminToken });
    assert.equal(listed.status, 200);
    for (const t of teams) {
        const row = listed.body.teams.find(r => r.username === t.username);
        assert.ok(Math.abs(row.score.value - expected(t._id)) < 1e-9, `${t.username} score`);
        assert.equal(row.score.received, ir[t._id]);
    }
    const s = Object.fromEntries(listed.body.teams.map(r => [r.username, r.score]));
    assert.ok(s.score3.rank < s.score2.rank, 'more investment received ranks higher');

    const detail = await call('GET', `/api/admin/teams/${teams[2]._id}`, { token: adminToken });
    assert.deepEqual(detail.body.team.score, s.score3);
    assert.equal(detail.body.rankedTeams, active.length);

    // The details view shows every value used, and the steps add up
    const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
    const calcFor = async (team) => (await call('GET', `/api/admin/teams/${team._id}`, { token: adminToken })).body.calculation;
    const c3 = await calcFor(teams[2]);
    assert.deepEqual(c3.weights, { IR: 0.6, PI: 0.4 });
    assert.equal(c3.teamCount, active.length);
    near(c3.averageReceived, avg, 'average IR');
    near(c3.maxReceived, maxIR, 'max IR');
    near(c3.maxProfit, maxPI, 'max profit');
    near(c3.received, ir[teams[2]._id], 'IR');
    near(c3.receivedRatio, ir[teams[2]._id] / maxIR, 'IR ratio');
    near(c3.receivedPart + c3.profitPart, c3.formula, 'parts add up to the formula');
    near(c3.formula + c3.adminPoints, c3.final, 'formula + points = final');
    near(c3.final, expected(teams[2]._id), 'final');

    const c1 = await calcFor(teams[0]);   // score1 invested in score2 and score3
    assert.equal(c1.profitItems.length, 2);
    near(c1.profitItems.reduce((s, i) => s + i.profit, 0), c1.profit, 'profit items add up');
    const toScore2 = c1.profitItems.find(i => i.team === 'Score 2');
    assert.equal(toScore2.amt, 1000);
    near(toScore2.teamReceived, ir[teams[1]._id], "target team's IR");
    near(toScore2.profit, 1000 * (ir[teams[1]._id] / avg), 'profit for one investment');

    // Scores stay out of every player-facing response
    const publicTeams = (await call('GET', '/api/business')).body.teams;
    assert.ok(publicTeams.every(t => Object.keys(t).sort().join() === 'id,team_name'), 'no score fields for players');
    const info = (await call('GET', `/api/business/${teams[2]._id}`)).body;
    assert.deepEqual(Object.keys(info).sort(), ['link', 'team_content', 'team_name']);
    // Admin points are added to the score as-is; the formula part does not change
    const lowest = teams[0];
    const before = s.score1;
    const award = await call('POST', `/api/admin/teams/${lowest._id}/points`, { token: adminToken, body: { points: 5 } });
    await call('POST', `/api/admin/teams/${lowest._id}/points`, { token: adminToken, body: { points: -2 } });
    let after = (await call('GET', `/api/admin/teams/${lowest._id}`, { token: adminToken })).body.team.score;
    assert.equal(after.points, 3);
    assert.ok(Math.abs(after.formula - before.formula) < 1e-9, 'formula part is unchanged');
    assert.ok(Math.abs(after.value - (before.formula + 3)) < 1e-9, 'score = formula + points');
    assert.equal(after.rank, 1, 'points can move a team up the ranking');

    // Revoked points stop counting
    const plus5 = award.body.awards.find(a => a.points === 5);
    await call('PATCH', `/api/admin/points/${plus5.id}`, { token: adminToken, body: { revoked: true } });
    after = (await call('GET', `/api/admin/teams/${lowest._id}`, { token: adminToken })).body.team.score;
    assert.ok(Math.abs(after.value - (before.formula - 2)) < 1e-9, 'revoked points are not added');

    // Ordering by score, highest first or lowest first, across pages; deleted teams last
    const values = async (order, extra = '') => {
        const rows = [];
        for (let page = 1; ; page++) {
            const r = await call('GET', `/api/admin/teams?status=all&sort=score&order=${order}&limit=2&page=${page}${extra}`, { token: adminToken });
            assert.equal(r.status, 200);
            rows.push(...r.body.teams);
            if (page >= r.body.pages) return rows;
        }
    };
    for (const order of ['desc', 'asc']) {
        const rows = await values(order);
        const scored = rows.filter(r => r.score).map(r => r.score.value);
        const sorted = [...scored].sort((a, b) => (order === 'desc' ? b - a : a - b));
        assert.deepEqual(scored, sorted, `sorted ${order}`);
        const firstDeleted = rows.findIndex(r => !r.score);
        if (firstDeleted !== -1) assert.ok(rows.slice(firstDeleted).every(r => !r.score), 'deleted teams last');
        assert.equal(rows.length, await User.countDocuments(), 'every team appears once');
    }
    const searched = await values('desc', '&q=score');
    assert.deepEqual(searched.map(r => r.username), ['score3', 'score2', 'score1'], 'search works with score order');

    const prof = (await call('GET', '/api/profile', { playerToken: tokens[2] })).body;
    assert.deepEqual(Object.keys(prof).sort(), ['balance', 'investments', 'name']);

    await Investment.deleteMany({ user: { $in: teams.map(t => t._id) } });
    await User.deleteMany({ _id: { $in: teams.map(t => t._id) } });
});

test('admin reverts investments received by a team or made by a team, refunding the investors', async () => {
    const teams = [];
    for (const n of [1, 2, 3]) teams.push(await new User({ username: `rev${n}`, name: `Rev ${n}`, password: 'password', desc: ' ', ppt: ' ' }).save());
    const tok = [];
    for (const n of [1, 2, 3]) tok.push((await playerLogin(`rev${n}`, 'password')).body.jwtToken);
    const invest = (i, j, amt) => call('POST', `/api/business/${teams[j]._id}`, { playerToken: tok[i], body: { amt } });
    for (const [i, j, amt] of [[0, 2, 1000], [1, 2, 500], [2, 0, 700], [2, 1, 300]]) assert.equal((await invest(i, j, amt)).status, 200);
    const bal = async (i) => (await User.findById(teams[i]._id)).Rbalance;
    const inv = (i, j) => Investment.findOne({ user: teams[i]._id, pitcher: teams[j]._id });
    const revert = (dir, i, ids, confirm = teams[i].username, opts = {}) =>
        call('POST', `/api/admin/teams/${teams[i]._id}/revert-${dir}`, { token: adminToken, body: { investmentIds: ids.map(String), confirmUsername: confirm }, ...opts });
    assert.deepEqual([await bal(0), await bal(1), await bal(2)], [6000, 6500, 6000]);

    // Guards: confirmation, a selection, admin only
    const r1to3 = (await inv(0, 2))._id;
    assert.equal((await revert('received', 2, [r1to3], 'wrong')).status, 400);
    assert.equal((await revert('received', 2, [])).status, 400);
    assert.equal((await revert('received', 2, ['nope'])).status, 400);
    assert.equal((await call('POST', `/api/admin/teams/${teams[2]._id}/revert-received`, { playerToken: tok[0], body: { investmentIds: [String(r1to3)], confirmUsername: 'rev3' } })).status, 401);

    // An investment on the other side of the team is ignored
    const r3to1 = (await inv(2, 0))._id;
    let res = await revert('received', 2, [r3to1]);
    assert.equal(res.status, 200);
    assert.equal(res.body.reverted, 0);
    assert.equal(res.body.skipped, 1);
    assert.ok(await inv(2, 0), 'not reverted');

    // Received: revert one of the two investments into rev3; that investor gets its money back
    res = await revert('received', 2, [r1to3]);
    assert.equal(res.body.reverted, 1);
    assert.equal(res.body.refunded, 1000);
    assert.deepEqual(res.body.refunds.map(r => [r.username, r.amount, r.balance]), [['rev1', 1000, 7000]]);
    assert.equal(await inv(0, 2), null);
    assert.ok(await inv(1, 2), 'the other investment is kept');
    assert.deepEqual([await bal(0), await bal(1), await bal(2)], [7000, 6500, 6000], 'only the investor is refunded');

    // Reverting again, even twice at the same time, never refunds twice
    const r2to3 = (await inv(1, 2))._id;
    const both = await Promise.all([revert('received', 2, [r2to3]), revert('received', 2, [r2to3])]);
    assert.equal(both.reduce((s, r) => s + r.body.reverted, 0), 1);
    assert.equal(await bal(1), 7000);
    assert.equal((await revert('received', 2, [r1to3])).body.reverted, 0);
    assert.equal(await bal(0), 7000);

    // Made: revert everything rev3 invested in others; rev3 gets it all back
    res = await revert('made', 2, [r3to1, (await inv(2, 1))._id]);
    assert.equal(res.body.reverted, 2);
    assert.equal(res.body.refunded, 1000);
    assert.deepEqual(res.body.refunds.map(r => [r.username, r.amount, r.balance]), [['rev3', 1000, 7000]]);
    assert.deepEqual([await bal(0), await bal(1), await bal(2)], [7000, 7000, 7000]);
    assert.equal(await Investment.countDocuments({ $or: [{ user: { $in: teams.map(t => t._id) } }, { pitcher: { $in: teams.map(t => t._id) } }] }), 0);

    // A reverted investment can be made again
    assert.equal((await invest(0, 2, 200)).status, 200);
    assert.equal((await call('GET', '/api/profile', { playerToken: tok[0] })).body.balance, 6800);

    await Investment.deleteMany({ user: { $in: teams.map(t => t._id) } });
    await User.deleteMany({ _id: { $in: teams.map(t => t._id) } });
});

test('player logout ends the session on the server', async () => {
    const token = (await playerLogin('legacy', 'password')).body.jwtToken;
    assert.equal((await call('POST', '/api/auth/logout', { playerToken: token })).status, 200);
    assert.equal((await call('GET', '/api/profile', { playerToken: token })).status, 403);
    assert.equal((await call('POST', '/api/auth/logout')).status, 401);
});

test('public registration is disabled unless explicitly enabled', async () => {
    const off = await call('POST', '/api/auth/register', { body: { username: 'self', password: 'password', name: 'Self' } });
    assert.equal(off.status, 403);

    process.env.ALLOW_PUBLIC_REGISTRATION = 'true';
    try {
        const on = await call('POST', '/api/auth/register', { body: { username: 'self', password: 'password', name: 'Self' } });
        assert.equal(on.status, 201);
        assert.equal((await playerLogin('self', 'password')).status, 200);
    } finally {
        delete process.env.ALLOW_PUBLIC_REGISTRATION;
    }
});

test('logout revokes the admin token', async () => {
    const out = await call('POST', '/api/admin/logout', { token: adminToken });
    assert.equal(out.status, 200);
    assert.equal((await call('GET', '/api/admin/me', { token: adminToken })).status, 401);
});

test('admin login is rate limited', async () => {
    let limited = false;
    for (let i = 0; i < 15 && !limited; i++) {
        const res = await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'wrong' } });
        limited = res.status === 429;
    }
    assert.ok(limited);
});
