import type { Route } from "./+types/collections.$name.$id";
import { Link } from "react-router";
import { ObjectId } from "mongodb";
import clientPromise from "../db.server";

export function meta({ data }: Route.MetaArgs) {
    if (!data || !data.doc) {
        return [{ title: "Document Not Found" }];
    }
    const title = data.doc.article?.title || "Untitled Document";
    return [
        { title: `${title} - ${data.collectionName}` },
        { name: "description", content: data.doc.article?.subtitle || "View document details" },
    ];
}

import { requireUser } from "../sessions.server";

export async function loader({ params, request }: Route.LoaderArgs) {
    await requireUser(request);
    const client = await clientPromise;
    const db = client.db("substack");
    const collection = db.collection(params.name);

    let doc;
    try {
        doc = await collection.findOne({ _id: new ObjectId(params.id) });
    } catch (e) {
        // Handle invalid ObjectId or other errors
        throw new Response("Invalid Document ID", { status: 400 });
    }

    if (!doc) {
        throw new Response("Document Not Found", { status: 404 });
    }

    return {
        collectionName: params.name,
        id: params.id,
        doc: JSON.parse(JSON.stringify(doc)), // Ensure serializability
    };
}

export default function DocumentRoute({ loaderData }: Route.ComponentProps) {
    const { doc, collectionName } = loaderData;

    return (
        <div className="min-h-screen bg-white font-sans">
            <header className="max-w-[700px] mx-auto pt-12 pb-8 px-6">
                <Link to={`/collections/${collectionName}`} className="text-blue-600 hover:underline mb-4 inline-block font-medium capitalize">
                    {collectionName}
                </Link>
                <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-2">
                    {doc.article?.title || "Untitled Document"}
                </h1>
                {doc.article?.subtitle && (
                    <h2 className="text-xl text-gray-500 font-serif leading-relaxed mb-4">
                        {doc.article.subtitle}
                    </h2>
                )}

                <div className="flex items-center text-gray-500 text-sm border-t border-gray-100 pt-4 mt-4">
                    {doc.article?.post_date && (
                        <time dateTime={doc.article.post_date}>
                            {new Date(doc.article.post_date).toLocaleDateString("en-US", {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            })}
                        </time>
                    )}
                </div>
            </header>

            <main className="px-6 pb-20">
                {doc.article?.body_html ? (
                    <div
                        className="prose prose-lg prose-slate font-serif mx-auto
                                       prose-headings:font-sans prose-headings:font-bold prose-headings:text-gray-900
                                       prose-p:text-gray-800 prose-p:leading-relaxed
                                       prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                                       prose-img:rounded-xl prose-img:shadow-md
                                       max-w-[700px]"
                        dangerouslySetInnerHTML={{ __html: doc.article.body_html }}
                    />
                ) : (
                    <div className="max-w-[700px] mx-auto">
                        <pre className="bg-gray-100 text-gray-800 p-4 rounded-lg overflow-x-auto text-sm font-mono leading-relaxed border border-gray-200">
                            {JSON.stringify(doc, null, 2)}
                        </pre>
                    </div>
                )}
            </main>
        </div>
    );
}
