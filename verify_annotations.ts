
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
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    });
}
// Mock process.env if still missing (unlikely)
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";

async function run() {
    try {
        // Dynamic import to ensure env is set
        const { default: clientPromise, getCollectionConnection, DB_NAMES } = await import("./app/db.server");

        const client = await clientPromise;
        const collectionName = "akonit";

        console.log(`Checking collection: ${collectionName}`);

        const { collection, dbName } = await getCollectionConnection(client, collectionName);
        console.log(`Connected to DB: ${dbName}`);

        const docs = await collection.find({}).limit(5).toArray();
        console.log(`Found ${docs.length} docs.`);

        if (docs.length === 0) {
            console.log("No docs found.");
            return;
        }

        const docIds = docs.map(d => d._id.toString());
        console.log("Checking annotations for IDs:", docIds);

        const annotationDb = client.db(DB_NAMES.SUBSTACK);
        const annotations = await annotationDb.collection("#annotations").find({
            documentId: { $in: docIds }
        }).toArray();

        console.log(`Found ${annotations.length} annotations.`);
        if (annotations.length > 0) {
            console.log("Sample annotation:", annotations[0]);
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

run();
