// config/mongo.js
const mongoose = require('mongoose');
require('dotenv').config(); 

async function init() {
    try {
        const dbUrl = process.env.DATABASE_URL;
        
        await mongoose.connect(dbUrl, {
        });
        
        console.log(`Connected to MongoDB (database: ${mongoose.connection.name})`);
    } catch (err) {
        // Only the message: the full error object can include connection details
        console.error('Error connecting to MongoDB:', err.message);
        process.exit(1); 
    }
}

module.exports = init;
