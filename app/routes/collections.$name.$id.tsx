import type { Route } from "./+types/collections.$name.$id";
import { Link, Form, useSearchParams, useFetcher, useSubmit, useNavigation } from "react-router";
import { ObjectId } from "mongodb";
import { useEffect, useState, useRef, useCallback } from "react";
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

    // Sidebar Data Fetching
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const searchTerm = url.searchParams.get("q") || "";
    const limit = 10;
    const skip = (page - 1) * limit;

    const filter = searchTerm
        ? { "article.title": { $regex: searchTerm, $options: "i" } }
        : {};

    const sidebarDocs = await collection
        .find(filter)
        .sort({ "article.post_date": -1 })
        .project({ _id: 1, "article.title": 1, "article.post_date": 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    const totalDocs = await collection.countDocuments(filter);

    // Current Document Fetching
    let doc;
    try {
        doc = await collection.findOne({ _id: new ObjectId(params.id) });
    } catch (e) {
        throw new Response("Invalid Document ID", { status: 400 });
    }

    if (!doc) {
        throw new Response("Document Not Found", { status: 404 });
    }

    return {
        collectionName: params.name,
        id: params.id,
        doc: JSON.parse(JSON.stringify(doc)),
        // Sidebar data
        sidebarDocuments: sidebarDocs.map((d) => ({
            id: d._id.toString(),
            title: d.article?.title || "Untitled Document",
            date: d.article?.post_date,
        })),
        page,
        totalPages: Math.ceil(totalDocs / limit),
        searchTerm,
    };
}

export default function DocumentRoute({ loaderData }: Route.ComponentProps) {
    const { doc, collectionName, sidebarDocuments, totalPages, searchTerm } = loaderData;
    const [searchParams] = useSearchParams();
    const submit = useSubmit();
    const navigation = useNavigation();
    const fetcher = useFetcher<typeof loaderData>();
    const [docs, setDocs] = useState(sidebarDocuments);
    const [page, setPage] = useState(1);
    const observer = useRef<IntersectionObserver | null>(null);
    const lastDocElementRef = useCallback((node: HTMLElement | null) => {
        if (fetcher.state === "loading") return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && page < totalPages) {
                const nextPage = page + 1;
                fetcher.load(`?page=${nextPage}${searchTerm ? `&q=${searchTerm}` : ''}`);
                setPage(nextPage);
            }
        });
        if (node) observer.current.observe(node);
    }, [fetcher.state, page, totalPages, searchTerm]);

    // Reset state when collection or search term changes
    useEffect(() => {
        setDocs(sidebarDocuments);
        setPage(1);
    }, [collectionName, searchTerm, sidebarDocuments]);

    // Append new docs when fetcher loads data
    useEffect(() => {
        if (fetcher.data && fetcher.data.sidebarDocuments) {
            setDocs(prevDocs => {
                const newDocs = fetcher.data!.sidebarDocuments.filter(
                    newDoc => !prevDocs.some(existing => existing.id === newDoc.id)
                );
                return [...prevDocs, ...newDocs];
            });
        }
    }, [fetcher.data]);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <div className="min-h-screen bg-white font-sans flex flex-col md:flex-row relative">
            {/* Mobile/Collapsed Toggle Button */}
            {!isSidebarOpen && (
                <button
                    onClick={() => setIsSidebarOpen(true)}
                    className="fixed left-4 top-24 z-20 p-2 bg-white border border-gray-200 rounded-md shadow-md text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-all print:hidden"
                    aria-label="Open sidebar"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                </button>
            )}

            {/* Sidebar */}
            <aside
                className={`
                    bg-gray-50 border-r border-gray-200 p-6 flex-shrink-0 
                    h-screen overflow-y-auto fixed md:sticky top-0 left-0
                    transition-all duration-300 ease-in-out
                    ${isSidebarOpen ? 'w-full md:w-80 translate-x-0 opacity-100 z-30' : 'w-0 -translate-x-full opacity-0 overflow-hidden p-0 border-none -z-10'}
                    [&::-webkit-scrollbar]:w-1.5
                    [&::-webkit-scrollbar-track]:bg-transparent
                    [&::-webkit-scrollbar-thumb]:bg-gray-200
                    [&::-webkit-scrollbar-thumb]:rounded-full
                    hover:[&::-webkit-scrollbar-thumb]:bg-gray-300
                    print:hidden
                `}
            >
                <div className="flex justify-end mb-4 md:hidden">
                    <button onClick={() => setIsSidebarOpen(false)} className="text-gray-500">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="mb-6 flex items-center gap-2">
                    <div className="flex-1">
                        <Form method="get" className="relative" onChange={(e) => {

                            const isFirstSearch = e.currentTarget.q.value.length > 0;
                            submit(e.currentTarget, {
                                replace: !isFirstSearch
                            });
                        }}>
                            <input
                                type="search"
                                name="q"
                                defaultValue={searchTerm}
                                className="block w-full p-2 text-sm text-gray-900 border border-gray-300 rounded-lg bg-white focus:ring-blue-500 focus:border-blue-500 pr-8"
                                placeholder="Search articles..."
                            />
                            {navigation.state === "loading" && navigation.location.search.includes("q=") && (
                                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                                    <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                </div>
                            )}
                        </Form>
                    </div>
                    <button
                        onClick={() => setIsSidebarOpen(false)}
                        className="p-2 text-gray-400 hover:text-gray-600 hidden md:block"
                        aria-label="Collapse sidebar"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                    </button>
                </div>

                <ul className="space-y-3">
                    {docs.map((d, index) => {
                        const isLast = index === docs.length - 1;
                        return (
                            <li key={d.id} ref={isLast ? lastDocElementRef : null}>
                                <Link
                                    to={`/collections/${collectionName}/${d.id}${searchTerm ? `?q=${searchTerm}&page=${page}` : ''}`}
                                    className={`block p-2 rounded-md transition-colors ${d.id === doc._id
                                        ? "bg-blue-50 text-blue-700 border-l-4 border-blue-600"
                                        : "text-gray-700 hover:bg-gray-100"
                                        }`}
                                >
                                    <span className={`block font-medium text-sm ${d.id === doc._id ? "font-bold" : ""}`}>
                                        {d.title}
                                    </span>
                                    {d.date && (
                                        <span className="block text-xs text-gray-400 mt-1">
                                            {new Date(d.date).toLocaleDateString()}
                                        </span>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>

                {fetcher.state === "loading" && (
                    <div className="py-4 text-center text-gray-500 text-sm">
                        Loading more...
                    </div>
                )}
            </aside>

            {/* Main Content */}
            <div className="flex-1 order-1 md:order-2 bg-white min-h-screen p-4 flex flex-col items-center">
                <div className="max-w-[800px] w-full">
                    <header className="pt-12 pb-8 px-6">
                        <p className="text-blue-600 mb-4 inline-block font-medium">
                            {collectionName}
                        </p>
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
                                className="prose prose-lg prose-slate font-serif
                                           prose-headings:font-sans prose-headings:font-bold prose-headings:text-gray-900
                                           prose-p:text-gray-800 prose-p:leading-relaxed
                                           prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                                           prose-img:rounded-xl prose-img:shadow-md
                                           w-full max-w-none"
                                dangerouslySetInnerHTML={{ __html: doc.article.body_html }}
                            />
                        ) : (
                            <div className="w-full">
                                <pre className="bg-gray-100 text-gray-800 p-4 rounded-lg overflow-x-auto text-sm font-mono leading-relaxed border border-gray-200">
                                    {JSON.stringify(doc, null, 2)}
                                </pre>
                            </div>
                        )}
                    </main>
                </div>
            </div>
        </div>
    );
}
