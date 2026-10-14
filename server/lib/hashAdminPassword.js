// Prints a bcrypt hash to use as ADMIN_PASSWORD_HASH. Usage: npm run hash-admin-password
const bcrypt = require('bcrypt')
const prompt = require('prompt-sync')()

const password = prompt.hide('Admin password: ')
if (!password || password.length < 12) {
    console.error('Use at least 12 characters for the admin password.')
    process.exit(1)
}
if (prompt.hide('Confirm password: ') !== password) {
    console.error('Passwords do not match.')
    process.exit(1)
}

console.log('\nADMIN_PASSWORD_HASH=' + bcrypt.hashSync(password, 12))
