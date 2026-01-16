import type { Route } from "./+types/collections.$name.$id";
import { Link, Form, useSearchParams, useFetcher, useSubmit, useNavigation, useLocation } from "react-router";
import { ObjectId } from "mongodb";
import { useEffect, useState, useRef, useCallback, memo } from "react";
import clientPromise from "../db.server";
import { highlightRange, serializeRange, deserializeRange } from "../utils/dom-annotations";
import type { SerializedRange } from "../utils/dom-annotations";

export function meta({ data }: Route.MetaArgs) {
    if (!data || !data.doc) {
        return [{ title: "Document Not Found" }];
    }
    const title = data.doc.article?.title || "Untitled Document";
    const articleId = data.doc.article?.id;

    return [
        { title: `${title} - ${data.collectionName}` },
        { name: "description", content: data.doc.article?.subtitle || "View document details" },
        ...(data.collectionName && articleId ? [{
            name: "dc.identifier",
            content: `substack/${data.collectionName}/${articleId}`,
        }] : []),
        { name: "dc.relation.ispartof", content: "tonys-file-cabinet" },
    ];
}

import { requireUser } from "../sessions.server";

export async function loader({ params, request }: Route.LoaderArgs) {
    await requireUser(request);
    const client = await clientPromise;
    const db = client.db("substack");
    const collection = db.collection(params.name);

    // 1. Fetch Current Document First
    let doc;
    try {
        doc = await collection.findOne({ _id: new ObjectId(params.id) });
    } catch (e) {
        throw new Response("Invalid Document ID", { status: 400 });
    }

    if (!doc) {
        throw new Response("Document Not Found", { status: 404 });
    }

    // 2. Determine Page for Sidebar
    const url = new URL(request.url);
    const searchTerm = url.searchParams.get("q") || "";
    const itemsPerPage = 20;

    // Default filter matches sidebar
    const filter = searchTerm
        ? { "article.title": { $regex: searchTerm, $options: "i" } }
        : {};

    // Calculate position of current doc to ensure it's loaded
    // Only calculate if we are viewing the main list (no active search filtering that might exclude this doc)
    // Or if search logic allows, but typically we want context.
    // If searchTerm is present, the doc might not even be in the result set if it doesn't match.
    // We'll perform the position count using the SAME filter.

    let targetPage = 1;
    if (doc.article?.post_date) {
        // Count how many docs are "before" this one in the sort order (post_date descending)
        // If searching, this only counts matching docs before this one.
        const positionQuery = {
            ...filter,
            "article.post_date": { $gt: doc.article.post_date }
        };
        const countBefore = await collection.countDocuments(positionQuery);
        targetPage = Math.ceil((countBefore + 1) / itemsPerPage);
    }

    const explicitPage = parseInt(url.searchParams.get("page") || "0", 10);
    const page = Math.max(targetPage, explicitPage, 1);

    const limit = page * itemsPerPage;
    const skip = 0;

    // 3. Fetch Sidebar Data with sufficient limit
    const sidebarDocs = await collection
        .find(filter)
        .sort({ "article.post_date": -1 })
        .project({ _id: 1, "article.title": 1, "article.post_date": 1, "article.audience": 1 })
        .skip(skip)
        .limit(limit)
        .toArray();

    const totalDocs = await collection.countDocuments(filter);

    return {
        collectionName: params.name,
        id: params.id,
        doc: JSON.parse(JSON.stringify(doc)),
        // Sidebar data
        sidebarDocuments: sidebarDocs.map((d) => ({
            id: d._id.toString(),
            title: d.article?.title || "Untitled Document",
            date: d.article?.post_date,
            audience: d.article?.audience,
        })),
        page, // This is the max page loaded
        totalPages: Math.ceil(totalDocs / itemsPerPage), // Calculate totals based on per-page limit
        searchTerm,
    };
}

// Memoize the content to prevent React from re-setting innerHTML on parent re-renders
const ArticleContent = memo(({ html }: { html: string }) => (
    <div
        id="article-content"
        className="prose prose-lg prose-slate font-serif
                   prose-headings:font-sans prose-headings:font-bold prose-headings:text-gray-900
                   prose-p:text-gray-800 prose-p:leading-relaxed
                   prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                   prose-img:rounded-xl prose-img:shadow-md
                   w-full max-w-none relative" // Added relative for positioning
        dangerouslySetInnerHTML={{ __html: html }}
    />
));

const Comment = ({ comment }: { comment: any }) => (
    <div className="group">
        <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900">{comment.name}</span>
                {comment.date && (
                    <span className="text-gray-400 text-sm">
                        {new Date(comment.date).toLocaleDateString("en-US", {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        })}
                    </span>
                )}
            </div>
        </div>
        <div className="text-gray-700 leading-relaxed text-base bg-gray-50 p-4 rounded-lg">
            {comment.body}
        </div>
        {comment.children && comment.children.length > 0 && (
            <div className="ml-6 mt-4 space-y-4 pl-4 border-l-2 border-gray-100">
                {comment.children.map((child: any) => (
                    <Comment key={child.id} comment={child} />
                ))}
            </div>
        )}
    </div>
);

const MediaLink = ({ label, filename, collectionName }: { label: string, filename: string, collectionName: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.preventDefault();
        const mediaFolder = "H:/My Drive/Scraper/media";
        const path = `file:///${mediaFolder}/substack/${collectionName}/${filename}`;

        navigator.clipboard.writeText(path).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            // Fallback?
        });
    };

    return (
        <div className="flex items-center gap-2">
            <span className="font-medium text-gray-500 w-16">{label}:</span>
            <button
                onClick={handleCopy}
                className="font-mono bg-white px-2 py-1 rounded border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors text-left flex items-center gap-2 group relative cursor-pointer"
                title="Click to copy file path"
            >
                <span className="truncate max-w-[300px]">{filename}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </span>
                {copied && (
                    <span className="absolute top-1/2 -translate-y-1/2 left-full ml-3 bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
                        Copied!
                        <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 bg-gray-900 rotate-45 transform origin-center"></div>
                    </span>
                )}
            </button>
        </div>
    );
};

export default function DocumentRoute({ loaderData }: Route.ComponentProps) {
    const { doc, collectionName, sidebarDocuments, totalPages, searchTerm, page: initialPage } = loaderData;
    const [searchParams] = useSearchParams();
    const submit = useSubmit();
    const navigation = useNavigation();
    const fetcher = useFetcher<typeof loaderData>();
    const [docs, setDocs] = useState(sidebarDocuments);
    const [page, setPage] = useState(1);
    const [isRestored, setIsRestored] = useState(false);

    // Annotation UI State
    const [activeAnnotation, setActiveAnnotation] = useState<{ id: string, rect: DOMRect } | null>(null);
    const [editingComment, setEditingComment] = useState("");


    // Cache Key
    const cacheKey = `${collectionName}_${searchTerm || 'def'}_sidebarData`;

    // Annotation State
    const [annotations, setAnnotations] = useState<any[]>([]);
    const [selection, setSelection] = useState<{ range: Range, rect: DOMRect } | null>(null);
    const annotationFetcher = useFetcher();
    const articleRef = useRef<HTMLDivElement>(null);

    // Fetch annotations on load
    useEffect(() => {
        if (doc._id) {
            annotationFetcher.load(`/api/annotations?documentId=${doc._id}&collectionName=${collectionName}`);
        }
    }, [doc._id, collectionName]);

    // Update state when fetcher returns
    useEffect(() => {
        if (!annotationFetcher.data) return;

        const data = annotationFetcher.data as any;

        // If we received a list of annotations (from loader)
        if (data.annotations) {
            setAnnotations(data.annotations);
        }

        // If an action succeeded (create/update/delete), reload the list
        // We check mutation status to avoid infinite loops if load returns success (unlikely)
        // But better: check if it's the result of a submission.
        // Actually, trigger load if data.success is true.
        if (data.success) {
            annotationFetcher.load(`/api/annotations?documentId=${doc._id}&collectionName=${collectionName}`);
        }
    }, [annotationFetcher.data, doc._id, collectionName]);

    // Apply highlights when annotations load or doc changes
    useEffect(() => {
        if (annotations.length > 0 && articleRef.current) {
            console.log("Applying annotations:", annotations.length);
            annotations.forEach(ann => {
                if (articleRef.current?.querySelector(`mark[data-annotation-id="${ann._id}"]`)) {
                    return;
                }
                const range = deserializeRange(ann.range, articleRef.current!);
                if (range) {
                    highlightRange(range, ann._id, ann.color);
                } else {
                    console.error("Failed to deserialize range for annotation", ann._id);
                }
            });
        } else {
            // console.log("No annotations to apply or articleRef missing", { count: annotations.length, ref: !!articleRef.current });
        }
    }, [annotations, doc._id]);

    // Handle user selection
    useEffect(() => {
        const handleSelectionChange = () => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                setSelection(null);
                return;
            }

            const range = sel.getRangeAt(0);
            if (articleRef.current && articleRef.current.contains(range.commonAncestorContainer)) {
                const rect = range.getBoundingClientRect();
                setSelection({ range, rect });
            } else {
                setSelection(null); // Clicked outside
            }
        };

        document.addEventListener("selectionchange", handleSelectionChange); // or mouseup
        return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, []);

    const saveAnnotation = (color: string) => {
        if (!selection || !articleRef.current) return;

        const serialized = serializeRange(selection.range, articleRef.current);
        if (!serialized) return;

        const range = selection.range; // Keep ref before clearing
        setSelection(null); // Hide toolbar

        // Optimistic UI? We need an ID for optimistic UI. 
        // For now, let's just submit and wait for re-fetch or use returned data?
        // Better: submit, and in action we return the new annotation.

        annotationFetcher.submit(
            {
                intent: "create",
                documentId: doc._id,
                collectionName,
                range: JSON.stringify(serialized),
                text: serialized.text,
                color,
                comment: ""
            },
            { method: "post", action: "/api/annotations" }
        );

        // Temporarily highlight (will be replaced by real one or persisted)
        // highlightRange(range, "temp-optimistic", color); 
        // We'll let the fetcher revalidation handle it to ensure ID is correct.
    };



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
    }, [fetcher.state, page, totalPages, searchTerm, collectionName]);

    // Reset state when collection or search term changes
    useEffect(() => {
        // Use initial data from loader
        setDocs(sidebarDocuments);
        setPage(1);
        // We don't manually clear cache here; we just switch keys or rely on loaderData for page 1
    }, [collectionName, searchTerm, sidebarDocuments]);

    const AudienceIcon = ({ audience }: { audience?: string }) => {
        if (audience === "only_paid") {
            return (
                <svg className="w-3 H-3 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <title>Paid</title>
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
            );
        }
        if (audience === "founding") {
            return (
                <svg className="w-3 h-3 text-purple-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <title>Founding</title>
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            );
        }
        return (
            <svg className="w-3 h-3 text-gray-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <title>Everyone</title>
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
        );
    };

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

    // Handle clicks on annotations
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains("annotation-highlight")) {
                const id = target.dataset.annotationId;
                if (id) {
                    // Find the annotation data to prepopulate comment
                    const ann = annotations.find(a => a._id === id);
                    if (ann) {
                        setEditingComment(ann.comment || "");
                        setActiveAnnotation({
                            id,
                            rect: target.getBoundingClientRect()
                        });
                        setSelection(null); // Clear text selection toolbar
                        e.stopPropagation(); // Prevent other clicks
                    }
                }
            } else if (!target.closest(".annotation-popover")) {
                // Click outside popover closes it
                setActiveAnnotation(null);
            }
        };

        if (articleRef.current) {
            articleRef.current.addEventListener("click", handleClick);
        }
        return () => {
            articleRef.current?.removeEventListener("click", handleClick);
        };
    }, [annotations]);

    const updateComment = () => {
        if (!activeAnnotation) return;
        annotationFetcher.submit(
            {
                intent: "update",
                annotationId: activeAnnotation.id,
                comment: editingComment
            },
            { method: "post", action: "/api/annotations" }
        );
        setActiveAnnotation(null);
    };

    const deleteAnnotation = () => {
        if (!activeAnnotation) return;
        annotationFetcher.submit(
            {
                intent: "delete",
                annotationId: activeAnnotation.id
            },
            { method: "post", action: "/api/annotations" }
        );

        // Optimistically remove highlight
        const highlights = articleRef.current?.querySelectorAll(`mark[data-annotation-id="${activeAnnotation.id}"]`);
        highlights?.forEach(el => {
            const parent = el.parentNode;
            if (parent) {
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
            }
        });

        setActiveAnnotation(null);
    };

    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [matchesMobile, setMatchesMobile] = useState(false); // Helper to track if we are on mobile
    const [enableTransitions, setEnableTransitions] = useState(false); // State to delay transitions until after restore
    const sidebarRef = useRef<HTMLElement>(null);

    // Persist sidebar open state
    useEffect(() => {
        const storedState = sessionStorage.getItem("sidebarOpen");
        if (storedState) {
            setIsSidebarOpen(storedState === "true");
        }
        // Enable transitions after a short delay to prevent animation on restore
        const timer = setTimeout(() => {
            setEnableTransitions(true);
        }, 150);
        return () => clearTimeout(timer);
    }, []);

    // Scroll active document into view
    useEffect(() => {
        // Short timeout to ensure DOM is ready and transitions don't interfere
        const timer = setTimeout(() => {
            const activeElement = document.getElementById("active-doc-item");
            if (activeElement) {
                activeElement.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [doc.id]); // Re-run when doc ID changes

    const toggleSidebar = (isOpen: boolean) => {
        setIsSidebarOpen(isOpen);
        sessionStorage.setItem("sidebarOpen", String(isOpen));
    };


    return (
        <div className="min-h-screen bg-white font-sans flex flex-col md:flex-row relative">
            {/* Mobile/Collapsed Toggle Button */}
            <button
                onClick={() => toggleSidebar(!isSidebarOpen)}
                className={`fixed top-24 z-40 p-2 bg-white border border-gray-200 rounded-md shadow-md text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-all duration-300 ease-in-out print:hidden ${isSidebarOpen ? "left-80 md:left-[21rem]" : "left-4"}`}
                aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {isSidebarOpen ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    )}
                </svg>
            </button>

            {/* Sidebar */}
            <aside
                ref={sidebarRef}
                className={`
                    bg-gray-50 border-r border-gray-200 flex-shrink-0 flex flex-col
                    h-screen md:h-[calc(100vh-3rem)] overflow-hidden fixed md:sticky top-0 md:top-12 left-0
                    ${enableTransitions ? 'transition-all duration-300 ease-in-out' : ''}
                    ${isSidebarOpen ? 'w-full md:w-80 translate-x-0 opacity-100 z-30' : 'w-0 -translate-x-full opacity-0 overflow-hidden p-0 border-none -z-10'}
                    print:hidden
                `}
            >
                <div className="p-6 pb-0 flex-shrink-0">
                    <div className="flex justify-end mb-4 md:hidden">
                        <button onClick={() => toggleSidebar(false)} className="text-gray-500">
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
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 pb-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-300">
                    <ul className="space-y-3">
                        {docs.map((d, index) => {
                            const isLast = index === docs.length - 1;
                            return (
                                <li
                                    key={d.id}
                                    ref={isLast ? lastDocElementRef : null}
                                    id={d.id === doc._id ? "active-doc-item" : undefined}
                                >
                                    <Link
                                        to={`/collections/${collectionName}/${d.id}${searchTerm ? `?q=${searchTerm}` : ''}`}
                                        className={`block p-2 rounded-md transition-colors ${d.id === doc._id
                                            ? "bg-blue-50 text-blue-700 border-l-4 border-blue-600"
                                            : "text-gray-700 hover:bg-gray-100"
                                            }`}
                                    >
                                        <span className={`block font-medium text-sm flex items-center gap-2 ${d.id === doc._id ? "font-bold" : ""}`}>
                                            <AudienceIcon audience={(d as any).audience} />
                                            <span className="truncate">{d.title}</span>
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

                    {
                        fetcher.state === "loading" && (
                            <div className="py-4 text-center text-gray-500 text-sm">
                                Loading more...
                            </div>
                        )
                    }
                </div>
            </aside >

            {/* Main Content */}
            < div className="flex-1 order-1 md:order-2 bg-white min-h-screen p-4 flex flex-col items-center" >
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

                        {doc.article?.audience && (
                            <div className="mb-4">
                                <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full uppercase tracking-wider font-semibold">
                                    Audience: {doc.article.audience}
                                </span>
                            </div>
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

                        {/* Media Section */}
                        {(doc.video || doc.audio || (doc.media && doc.media.length > 0)) && (
                            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-100">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Media Files</h3>
                                <div className="space-y-2 text-sm text-gray-700">
                                    {doc.video && (
                                        <MediaLink label="Video" filename={doc.video} collectionName={collectionName} />
                                    )}
                                    {doc.audio && (
                                        <MediaLink label="Audio" filename={doc.audio} collectionName={collectionName} />
                                    )}
                                    {doc.media?.map((m: string, i: number) => (
                                        <MediaLink key={i} label="Media" filename={m} collectionName={collectionName} />
                                    ))}
                                </div>
                            </div>
                        )}
                    </header>

                    <main className="px-6 pb-20">
                        {doc.article?.body_html ? (
                            <div ref={articleRef} className="relative">
                                <ArticleContent html={doc.article.body_html} />
                                {selection && (
                                    <div
                                        style={{
                                            position: 'fixed',
                                            top: `${selection.rect.top - 40}px`,
                                            left: `${selection.rect.left}px`,
                                            zIndex: 50
                                        }}
                                        className="bg-white shadow-xl rounded-lg border border-gray-200 p-1 flex gap-1"
                                    >
                                        <button onClick={() => saveAnnotation("#fef9c3")} className="w-6 h-6 rounded-full bg-[#fef9c3] hover:scale-110 transition-transform border border-gray-200" title="Yellow"></button>
                                        <button onClick={() => saveAnnotation("#dcfce7")} className="w-6 h-6 rounded-full bg-[#dcfce7] hover:scale-110 transition-transform border border-gray-200" title="Green"></button>
                                        <button onClick={() => saveAnnotation("#fce7f3")} className="w-6 h-6 rounded-full bg-[#fce7f3] hover:scale-110 transition-transform border border-gray-200" title="Pink"></button>
                                    </div>
                                )}

                                {activeAnnotation && (
                                    <div
                                        className="annotation-popover fixed z-50 bg-white shadow-2xl rounded-lg border border-gray-200 p-4 w-80 ring-1 ring-gray-900/5"
                                        style={{
                                            top: `${activeAnnotation.rect.bottom + 10}px`,
                                            left: `${Math.min(window.innerWidth - 320, Math.max(10, activeAnnotation.rect.left))}px`
                                        }}
                                    >
                                        <h4 className="font-bold text-gray-800 mb-2 text-sm">Annotation</h4>
                                        <textarea
                                            className="w-full border border-gray-300 rounded-md p-3 text-sm mb-3 min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none bg-gray-50 focus:bg-white transition-colors text-gray-900"
                                            placeholder="Write your comment here..."
                                            value={editingComment}
                                            onChange={(e) => setEditingComment(e.target.value)}
                                            autoFocus
                                        />
                                        <div className="flex justify-between items-center">
                                            <button
                                                onClick={deleteAnnotation}
                                                className="text-red-500 text-xs hover:underline"
                                            >
                                                Delete
                                            </button>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setActiveAnnotation(null)}
                                                    className="px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={updateComment}
                                                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="w-full">
                                <pre className="bg-gray-100 text-gray-800 p-4 rounded-lg overflow-x-auto text-sm font-mono leading-relaxed border border-gray-200">
                                    {JSON.stringify(doc, null, 2)}
                                </pre>
                            </div>
                        )}

                        {/* Transcript Section */}
                        {doc.transcript && (
                            <section className="mt-16 border-t border-gray-100 pt-10">
                                <h3 className="text-2xl font-bold text-gray-900 mb-6">Transcript</h3>
                                <div className="prose prose-lg prose-slate text-gray-700 leading-relaxed bg-gray-50 p-6 rounded-xl border border-gray-100 whitespace-pre-wrap font-serif w-full max-w-none">
                                    {doc.transcript}
                                </div>
                            </section>
                        )}

                        {/* Comments Section */}
                        {(doc.comments?.comments?.length > 0 || doc.article?.comments?.length > 0) && (
                            <section className="mt-16 border-t border-gray-100 pt-10">
                                <h3 className="text-2xl font-bold text-gray-900 mb-8">Comments</h3>
                                <div className="space-y-8">
                                    {(doc.comments?.comments || doc.article?.comments || []).map((comment: any) => (
                                        <Comment key={comment.id} comment={comment} />
                                    ))}
                                </div>
                            </section>
                        )}
                    </main>
                </div>
            </div >
        </div >
    );
}
