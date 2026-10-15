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

test('profile names the other team for investments made and received, including old and removed teams', async () => {
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
    assert.deepEqual(profile.body.received, [{ amt: 200, team: 'Prof Two', teamDeleted: false }]);
    assert.ok(!/password|\$2[aby]\$|deletedAt|jwt/i.test(JSON.stringify(profile.body)), 'no account secrets in the profile');

    // Removing the investor keeps the history, flagged as removed
    await User.updateOne({ _id: two._id }, { deletedAt: new Date() });
    profile = await call('GET', '/api/profile', { playerToken: t1 });
    assert.deepEqual(profile.body.received, [{ amt: 200, team: 'Prof Two', teamDeleted: true }]);

    const empty = await call('GET', '/api/profile', { playerToken: (await playerLogin('nameless', 'password')).body.jwtToken });
    assert.equal(empty.body.name, 'nameless');
    assert.deepEqual(empty.body.investments, []);
    assert.deepEqual(empty.body.received, [{ amt: 300, team: 'Prof One', teamDeleted: false }]);

    await Investment.deleteMany({ $or: [{ user: { $in: [one._id, two._id] } }, { pitcher: one._id }] });
    await User.deleteMany({ _id: { $in: [namelessId, one._id, two._id] } });
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
