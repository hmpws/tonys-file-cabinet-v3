import type { Route } from "./+types/api.annotations";
import { data } from "react-router";
import { ObjectId } from "mongodb";
import clientPromise from "../db.server";
import { requireUser } from "../sessions.server";

export async function loader({ request }: Route.LoaderArgs) {
    await requireUser(request);
    const url = new URL(request.url);
    const documentId = url.searchParams.get("documentId");
    const collectionName = url.searchParams.get("collectionName");

    if (!documentId || !collectionName) {
        throw data({ error: "Missing documentId or collectionName" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("substack");

    const annotations = await db.collection("#annotations").find({
        documentId,
        collectionName
    }).toArray();

    return { annotations: annotations.map(a => ({ ...a, _id: a._id.toString() })) };
}

export async function action({ request }: Route.ActionArgs) {
    const userId = await requireUser(request);
    const formData = await request.formData();
    const intent = formData.get("intent");

    const client = await clientPromise;
    const db = client.db("substack");
    const collection = db.collection("#annotations");

    if (intent === "create") {
        const documentId = formData.get("documentId") as string;
        const collectionName = formData.get("collectionName") as string;
        const range = formData.get("range") as string;
        const text = formData.get("text") as string; // Selected text
        const comment = formData.get("comment") as string;
        const color = formData.get("color") as string || "#fef9c3";
        const tagsRaw = formData.get("tags") as string;
        const tags = tagsRaw ? JSON.parse(tagsRaw) : [];

        if (!documentId || !collectionName) {
            throw data({ error: "Missing required fields" }, { status: 400 });
        }

        const newAnnotation = {
            documentId,
            collectionName,
            range: range && range !== "null" ? JSON.parse(range) : null,
            text,
            comment,
            color,
            tags,
            userId: userId, // Corrected from user.id
            username: "User", // Placeholder, we don't have username in session
            createdAt: new Date()
        };

        const result = await collection.insertOne(newAnnotation);

        return {
            success: true,
            annotation: { ...newAnnotation, _id: result.insertedId.toString() }
        };
    }

    if (intent === "delete") {
        const annotationId = formData.get("annotationId") as string;
        if (!annotationId) return data({ error: "Missing ID" }, { status: 400 });

        await collection.deleteOne({
            _id: new ObjectId(annotationId),
            userId: userId // Ensure ownership
        });

        return { success: true, deletedId: annotationId };
    }

    if (intent === "update") {
        const annotationId = formData.get("annotationId") as string;
        const comment = formData.get("comment") as string;
        const tagsRaw = formData.get("tags") as string;

        const updateDoc: any = { comment, updatedAt: new Date() };
        if (tagsRaw) {
            updateDoc.tags = JSON.parse(tagsRaw);
        }

        if (!annotationId) return data({ error: "Missing ID" }, { status: 400 });

        await collection.updateOne(
            { _id: new ObjectId(annotationId), userId: userId },
            { $set: updateDoc }
        );

        return { success: true, annotationId };
    }

    if (intent === "upsertGeneral") {
        const documentId = formData.get("documentId") as string;
        const collectionName = formData.get("collectionName") as string;
        const comment = formData.get("comment") as string;
        const tagsRaw = formData.get("tags") as string;
        const tags = tagsRaw ? JSON.parse(tagsRaw) : [];
        const color = formData.get("color") as string || "#e5e7eb";

        if (!documentId || !collectionName) {
            throw data({ error: "Missing required fields" }, { status: 400 });
        }

        const filter = { documentId, collectionName, range: null };
        const update = {
            $set: {
                comment,
                tags,
                color,
                userId,
                updatedAt: new Date(),
                // Ensure required fields exist on insert
                username: "User",
                createdAt: new Date()
            }
        };

        const result = await collection.updateOne(filter, update, { upsert: true });

        // If we upserted (created), we might need the ID.
        // If updated, we have the ID from search? No, updateOne doesn't return ID easily if found.
        // But for General Note, we can rely on re-fetching.
        // Or we can assume success.

        return { success: true };
    }

    if (intent === "toggleStatus") {
        const documentId = formData.get("documentId") as string;
        const collectionName = formData.get("collectionName") as string;
        const field = formData.get("field") as string; // "read" or "liked"
        const value = formData.get("value") === "true"; // "true" -> true, others -> false

        if (!documentId || !collectionName || !["read", "liked"].includes(field)) {
            throw data({ error: "Missing required fields or invalid field" }, { status: 400 });
        }

        const filter = { documentId, collectionName, range: null };

        // We use $set to update the specific field without overwriting others (comment, tags, etc.)
        // But we must also ensure base fields exist if this is the first time we touch the general note.
        // $setOnInsert is used for that.

        const update = {
            $set: {
                [field]: value,
                updatedAt: new Date(),
                userId // Update owner on toggle? Maybe just last modifier.
            },
            $setOnInsert: {
                username: "User",
                createdAt: new Date(),
                comment: "",
                tags: [],
                color: "#e5e7eb",
                range: null
            }
        };

        await collection.updateOne(filter, update, { upsert: true });

        return { success: true, field, value };
    }

    if (intent === "addTag") {
        const documentId = formData.get("documentId") as string;
        const collectionName = formData.get("collectionName") as string;
        const tag = formData.get("tag") as string;

        if (!documentId || !collectionName || !tag) {
            throw data({ error: "Missing required fields" }, { status: 400 });
        }

        const filter = { documentId, collectionName, range: null };
        const update = {
            $addToSet: { tags: tag },
            $set: { updatedAt: new Date(), userId },
            $setOnInsert: {
                username: "User",
                createdAt: new Date(),
                comment: "",
                color: "#e5e7eb",
                read: false,
                liked: false,
                range: null
            }
        };

        await collection.updateOne(filter, update, { upsert: true });
        return { success: true };
    }

    if (intent === "removeTag") {
        const documentId = formData.get("documentId") as string;
        const collectionName = formData.get("collectionName") as string;
        const tag = formData.get("tag") as string;

        if (!documentId || !collectionName || !tag) {
            throw data({ error: "Missing required fields" }, { status: 400 });
        }

        const filter = { documentId, collectionName, range: null };
        const update: any = {
            $pull: { tags: tag },
            $set: { updatedAt: new Date(), userId }
        };

        await collection.updateOne(filter, update);
        return { success: true };
    }

    throw data({ error: "Invalid intent" }, { status: 400 });
}
