import type { Route } from "./+types/collections.$name";
import { Link, useSearchParams, Form, useSubmit, useNavigation } from "react-router";
import clientPromise from "../db.server";

export function meta({ params }: Route.MetaArgs) {
    // ... existing meta ...
}

import { requireUser } from "../sessions.server";

export async function loader({ params, request }: Route.LoaderArgs) {
    await requireUser(request);
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const searchTerm = url.searchParams.get("q") || "";
    const limit = 10;
    const skip = (page - 1) * limit;

    const client = await clientPromise;
    const db = client.db("substack");
    const collection = db.collection(params.name);

    const filter = searchTerm
        ? { "article.title": { $regex: searchTerm, $options: "i" } }
        : {};

    // Projection to get _id, article.title, and article.post_date
    const documents = await collection
        .find(filter)
        .sort({ "article.post_date": -1 })
        .project({ _id: 1, "article.title": 1, "article.post_date": 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    const totalDocs = await collection.countDocuments(filter);

    return {
        collectionName: params.name,
        documents: documents.map((doc) => ({
            id: doc._id.toString(),
            title: doc.article?.title || "Untitled Document",
            date: doc.article?.post_date,
        })),
        page,
        totalPages: Math.ceil(totalDocs / limit),
        searchTerm,
    };
}

export default function CollectionRoute({ loaderData }: Route.ComponentProps) {
    const { collectionName, documents, page, totalPages } = loaderData;
    const [searchParams] = useSearchParams();
    const submit = useSubmit();
    const navigation = useNavigation();
    const isSearching = navigation.state === "loading" && navigation.location.search.includes("q=");

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 font-sans p-4">
            <div className="max-w-2xl w-full bg-white shadow-lg rounded-xl overflow-hidden">
                <header className="bg-blue-600 text-white p-6">
                    <h1 className="text-3xl font-bold">{collectionName}</h1>
                    <p className="mt-2 text-blue-100">Browse documents in this collection</p>
                </header>

                <main className="p-6">
                    <div className="mb-6">
                        <Form method="get" className="relative" onChange={(e) => {
                            const isFirstSearch = e.currentTarget.q.value.length > 0;
                            submit(e.currentTarget, {
                                replace: !isFirstSearch
                            });
                        }}>
                            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                <svg className="w-4 h-4 text-gray-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z" />
                                </svg>
                            </div>
                            <input
                                type="search"
                                name="q"
                                defaultValue={loaderData.searchTerm}
                                className="block w-full p-4 pl-10 pr-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 hover:border-gray-400 transition-colors"
                                placeholder="Search documents..."
                            />
                            {isSearching && (
                                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                    <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                </div>
                            )}
                        </Form>
                    </div>

                    {documents.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            No documents found in this collection.
                        </div>
                    ) : (
                        <ul className="grid grid-cols-1 gap-4">
                            {documents.map((doc) => (
                                <li key={doc.id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors duration-200 group">
                                    <Link
                                        to={`/collections/${collectionName}/${doc.id}`}
                                        className="block w-full h-full py-4 px-2"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col overflow-hidden">
                                                <div className="flex items-baseline space-x-3 truncate">
                                                    <span className="text-lg font-medium text-gray-800 group-hover:text-blue-600 transition-colors">
                                                        {doc.title}
                                                    </span>
                                                    {doc.date && (
                                                        <span className="text-sm text-gray-400 font-normal">
                                                            {new Date(doc.date).toLocaleDateString("en-US", {
                                                                year: 'numeric',
                                                                month: 'long',
                                                                day: 'numeric'
                                                            })}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <svg
                                                className="w-5 h-5 text-gray-300 group-hover:text-blue-500 flex-shrink-0 ml-4 transition-colors"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth="2"
                                                    d="M9 5l7 7-7 7"
                                                />
                                            </svg>
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex justify-center mt-8 space-x-2">
                            <Link
                                to={`?page=${page - 1}`}
                                className={`px-4 py-2 border rounded-md ${page <= 1
                                    ? "bg-gray-100 text-gray-400 pointer-events-none"
                                    : "bg-white text-gray-700 hover:bg-gray-50"
                                    }`}
                                aria-disabled={page <= 1}
                            >
                                Previous
                            </Link>
                            <span className="px-4 py-2 text-gray-600">
                                Page {page} of {totalPages}
                            </span>
                            <Link
                                to={`?page=${page + 1}`}
                                className={`px-4 py-2 border rounded-md ${page >= totalPages
                                    ? "bg-gray-100 text-gray-400 pointer-events-none"
                                    : "bg-white text-gray-700 hover:bg-gray-50"
                                    }`}
                                aria-disabled={page >= totalPages}
                            >
                                Next
                            </Link>
                        </div>
                    )}
                </main>


            </div>
        </div>
    );
}
