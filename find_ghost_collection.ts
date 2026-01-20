
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    content.split("\n").forEach(line => {
        line = line.trim();
        if (!line || line.startsWith("#")) return;
        const idx = line.indexOf("=");
        if (idx > 0) {
            const key = line.substring(0, idx).trim();
            let value = line.substring(idx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    });
}
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";

async function run() {
    // Dynamic import
    const { default: clientPromise, getCollectionConnection, getAllCollections, DB_NAMES } = await import("./app/db.server");
    const client = await clientPromise;

    console.log("Checking for Ghost collections...");

    // We can iterate simple names or just check getAllCollections output if it exposed DB name?
    // getAllCollections returns { name, lastFetched, ... }
    // It doesn't return DB name.

    // Let's manually access ghost DB
    const ghostDb = client.db(DB_NAMES.GHOST);
    const ghostCollections = await ghostDb.listCollections().toArray();

    console.log(`Found ${ghostCollections.length} collections in Ghost DB:`);
    ghostCollections.forEach(c => console.log(` - ${c.name}`));

    if (ghostCollections.length > 0) {
        console.log(`\nWe will use '${ghostCollections[0].name}' for verification.`);
    } else {
        console.log("\nNo Ghost collections found. Please Ensure Ghost DB is populated.");
    }

    process.exit(0);
}

run();
