import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
    throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = process.env.MONGODB_URI;
const options = {};

let client;
let clientPromise: Promise<MongoClient>;

declare global {
    var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === "development") {
    // In development mode, use a global variable so that the value
    // is preserved across module reloads caused by HMR (Hot Module Replacement).
    if (!global._mongoClientPromise) {
        client = new MongoClient(uri, options);
        global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
} else {
    // In production mode, it's best to not use a global variable.
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
}

export default clientPromise;

export const DB_NAMES = {
    SUBSTACK: "substack",
    GHOST: "ghost"
};

export async function getCollectionConnection(client: MongoClient, collectionName: string) {
    const substackDb = client.db(DB_NAMES.SUBSTACK);
    const ghostDb = client.db(DB_NAMES.GHOST);

    // Check if collection exists in Substack DB
    const substackCollections = await substackDb.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
    if (substackCollections.length > 0) {
        return { db: substackDb, collection: substackDb.collection(collectionName), dbName: DB_NAMES.SUBSTACK };
    }

    // Check if collection exists in Ghost DB
    const ghostCollections = await ghostDb.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
    if (ghostCollections.length > 0) {
        return { db: ghostDb, collection: ghostDb.collection(collectionName), dbName: DB_NAMES.GHOST };
    }

    // Default to Substack if not found (or throw error? For now default to substack to be safe)
    return { db: substackDb, collection: substackDb.collection(collectionName), dbName: DB_NAMES.SUBSTACK };
}

export async function getAllCollections(client: MongoClient) {
    const substackDb = client.db(DB_NAMES.SUBSTACK);
    const ghostDb = client.db(DB_NAMES.GHOST);

    const [substackCollections, ghostCollections] = await Promise.all([
        substackDb.listCollections().toArray(),
        ghostDb.listCollections().toArray()
    ]);

    // Helper to process collections
    const processCollections = async (cols: any[], db: any, dbName: string) => {
        const isGhost = dbName === DB_NAMES.GHOST;
        // Determine correct date field
        const dateField = isGhost ? "article.published_at" : "article.post_date";

        return Promise.all(cols.map(async (c) => {
            const doc = await db.collection(c.name).findOne({}, { sort: { [dateField]: -1 }, projection: { [dateField]: 1 } });
            // Retrieve correct date field
            const lastFetched = isGhost ? (doc?.article as any)?.published_at : doc?.article?.post_date;

            return {
                name: c.name,
                lastFetched: lastFetched || null,
                dbName
            };
        }));
    };

    const sProcessed = await processCollections(substackCollections, substackDb, DB_NAMES.SUBSTACK);
    const gProcessed = await processCollections(ghostCollections, ghostDb, DB_NAMES.GHOST);

    const all = [...sProcessed, ...gProcessed];

    // Sort
    all.sort((a, b) => a.name.localeCompare(b.name));

    return all;
}
