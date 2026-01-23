import type { Route } from "./+types/collections.$name.$id";
import { Link, Form, useSearchParams, useFetcher, useSubmit, useNavigation, useLocation } from "react-router";
import { ObjectId } from "mongodb";
import { useEffect, useState, useRef, useCallback, memo, useLayoutEffect } from "react";
import clientPromise from "../db.server";
import { highlightRange, serializeRange, deserializeRange } from "../utils/dom-annotations";
import type { SerializedRange } from "../utils/dom-annotations";

export function meta({ data }: Route.MetaArgs) {
    if (!data || !data.doc) {
        return [{ title: "Document Not Found" }];
    }
    const title = data.doc.article?.title || "Untitled Document";
    const articleId = data.doc.article?.id;
    const collectionName = data.collectionName;
    let date = "";
    if (data.doc.article?.post_date) {
        const d = new Date(data.doc.article.post_date);
        date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const fullTitle = date ? `${collectionName} - ${date} - ${title}` : `${collectionName} - ${title}`;

    return [
        { title },
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
    const { getCollectionConnection } = await import("../db.server");

    // 1. Get correct DB connection
    const { collection, dbName } = await getCollectionConnection(client, params.name);
    // Annotations always live in substack DB
    const annotationDb = client.db("substack");

    // Determine date field
    const isGhost = dbName === "ghost";
    const dateField = isGhost ? "article.published_at" : "article.post_date";

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

    // Normalize date for consistency in UI and Logic
    // If it's Ghost, we map published_at to post_date so the rest of the app "just works"
    if (isGhost && (doc.article as any)?.published_at) {
        if (!doc.article) doc.article = {} as any;
        doc.article.post_date = (doc.article as any).published_at;
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
    let targetPage = 1;
    if (doc.article?.post_date) {
        // Count how many docs are "before" this one in the sort order (descending)
        const positionQuery = {
            ...filter,
            [dateField]: { $gt: doc.article.post_date }
        };
        const countBefore = await collection.countDocuments(positionQuery);
        targetPage = Math.ceil((countBefore + 1) / itemsPerPage);
    }

    const explicitPage = parseInt(url.searchParams.get("page") || "0", 10);
    const page = Math.max(targetPage, explicitPage, 1);

    const limit = page * itemsPerPage;
    const skip = 0;

    // 3. Fetch Sidebar Data with sufficient limit
    // Projection needs the correct date field
    const projectFields: any = { _id: 1, "article.title": 1, "article.audience": 1 };
    projectFields[dateField] = 1;

    const sidebarDocs = await collection
        .find(filter)
        .sort({ [dateField]: -1 })
        .project(projectFields)
        .skip(skip)
        .limit(limit)
        .limit(limit)
        .toArray();

    // 4. Fetch Statuses (Read/Liked) for Sidebar & Current Doc
    const sidebarIds = sidebarDocs.map(d => d._id.toString());
    const allIds = [...sidebarIds, params.id]; // Include current doc

    const statusMap: Record<string, { read: boolean, liked: boolean, tags: string[] }> = {};
    const statuses = await annotationDb.collection("#annotations").find({
        documentId: { $in: allIds },
        range: null
    }).project({ documentId: 1, read: 1, liked: 1, tags: 1 }).toArray();

    statuses.forEach(s => {
        statusMap[s.documentId] = { read: !!s.read, liked: !!s.liked, tags: s.tags || [] };
    });

    const totalDocs = await collection.countDocuments(filter);

    return {
        collectionName: params.name,
        id: params.id,
        doc: JSON.parse(JSON.stringify(doc)),
        docStatus: statusMap[params.id as string] || { read: false, liked: false, tags: [] },
        // Sidebar data
        sidebarDocuments: sidebarDocs.map((d) => ({
            id: d._id.toString(),
            title: d.article?.title || "Untitled Document",
            // Map correct date field to 'date'
            date: isGhost ? (d.article as any).published_at : d.article?.post_date,
            audience: d.article?.audience,
            read: statusMap[d._id.toString()]?.read || false,
            liked: statusMap[d._id.toString()]?.liked || false,
            tags: statusMap[d._id.toString()]?.tags || [],
        })),
        source: isGhost ? "ghost" : "substack", // Pass source to component
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

const MediaLink = ({ label, filename, collectionName, source }: { label: string, filename: string, collectionName: string, source: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.preventDefault();
        const mediaFolder = "H:/My Drive/Scraper/media";
        const path = `file:///${mediaFolder}/${source}/${collectionName}/${filename}`;

        navigator.clipboard.writeText(path).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            // Fallback?
        });
    };

    return (
        <div className="flex items-center gap-2 max-w-full">
            <span className="font-medium text-gray-500 w-16 shrink-0">{label}:</span>
            <button
                onClick={handleCopy}
                className="font-mono bg-white px-2 py-1 rounded border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors text-left flex items-center gap-2 group relative cursor-pointer min-w-0"
                title="Click to copy file path"
            >
                <span className="truncate">{filename}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 shrink-0">
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
    const { doc, collectionName, sidebarDocuments, totalPages, searchTerm, page: initialPage, source } = loaderData;
    const [searchParams] = useSearchParams();
    const submit = useSubmit();
    const navigation = useNavigation();
    const fetcher = useFetcher<typeof loaderData>();
    const [docs, setDocs] = useState(sidebarDocuments);
    const [page, setPage] = useState(1);
    const [isRestored, setIsRestored] = useState(false);
    const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Document Status (Read/Liked)
    const [docStatus, setDocStatus] = useState(loaderData.docStatus);
    const statusFetcher = useFetcher();

    useEffect(() => {
        setDocStatus(loaderData.docStatus);
    }, [loaderData.docStatus]);

    const toggleStatus = (field: "read" | "liked") => {
        const newValue = !docStatus[field];
        setDocStatus((prev: any) => ({ ...prev, [field]: newValue })); // Optimistic

        statusFetcher.submit({
            intent: "toggleStatus",
            documentId: doc._id,
            collectionName,
            field,
            value: String(newValue)
        }, { method: "post", action: "/api/annotations" });
    };

    const addTag = (tag: string) => {
        if (!tag || docStatus.tags?.includes(tag)) return;
        setDocStatus((prev: any) => ({ ...prev, tags: [...(prev.tags || []), tag] }));

        statusFetcher.submit({
            intent: "addTag",
            documentId: doc._id,
            collectionName,
            tag
        }, { method: "post", action: "/api/annotations" });
    };

    const removeTag = (tag: string) => {
        setDocStatus((prev: any) => ({ ...prev, tags: (prev.tags || []).filter((t: string) => t !== tag) }));

        statusFetcher.submit({
            intent: "removeTag",
            documentId: doc._id,
            collectionName,
            tag
        }, { method: "post", action: "/api/annotations" });
    };

    useEffect(() => {
        const handleStatusChange = () => {
            setIsOnline(navigator.onLine);
        };
        window.addEventListener("online", handleStatusChange);
        window.addEventListener("offline", handleStatusChange);
        return () => {
            window.removeEventListener("online", handleStatusChange);
            window.removeEventListener("offline", handleStatusChange);
        };
    }, []);

    // Annotation UI State
    const [activeAnnotation, setActiveAnnotation] = useState<{ id: string, rect: DOMRect } | null>(null);
    const [editingComment, setEditingComment] = useState("");
    const [editingTags, setEditingTags] = useState<string[]>([]);

    // Ref for Autosave Access
    const editingStateRef = useRef({ activeAnnotation, editingComment, editingTags });
    useEffect(() => {
        editingStateRef.current = { activeAnnotation, editingComment, editingTags };
    }, [activeAnnotation, editingComment, editingTags]);


    // Cache Key
    const cacheKey = `${collectionName}_${searchTerm || 'def'}_sidebarData`;

    // Annotation State
    const [annotations, setAnnotations] = useState<any[]>([]);
    const [selection, setSelection] = useState<{ range: Range, rect: DOMRect } | null>(null);
    const annotationFetcher = useFetcher();
    const articleRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);

    // Fetch annotations on load
    useEffect(() => {
        setAnnotations([]); // Clear old highlights immediately
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
            // STRICTLY filter annotations to match current document
            const validAnnotations = data.annotations.filter((a: any) => a.documentId === doc._id);
            setAnnotations(validAnnotations);
        }

        // If an action succeeded (create/update/delete), reload the list
        if (data.success) {
            annotationFetcher.load(`/api/annotations?documentId=${doc._id}&collectionName=${collectionName}`);
        }
    }, [annotationFetcher.data, doc._id, collectionName]);

    // Side Note State
    const [positionedAnnotations, setPositionedAnnotations] = useState<any[]>([]);

    // Apply highlights when annotations load or doc changes
    useEffect(() => {
        if (!articleRef.current) return;

        // 1. Highlight and Collect Positions
        const newPositions: any[] = [];

        // Filter annotations relevant to THIS document to avoid race conditions
        const relevantAnnotations = annotations.filter(a => a.documentId === doc._id);

        if (relevantAnnotations.length > 0) {
            relevantAnnotations.forEach(ann => {
                try {
                    // Skip general notes in this loop (handled separately)
                    if (ann.range === "null" || !ann.range) return;

                    // Check if already applied
                    let mark = articleRef.current?.querySelector(`mark[data-annotation-id="${ann._id}"]`) as HTMLElement;

                    if (!mark) {
                        const range = deserializeRange(ann.range, articleRef.current!);
                        if (range) {
                            const marks = highlightRange(range, ann._id, ann.color);
                            if (marks.length > 0) mark = marks[0];
                        } else {
                            // console.error("Failed to deserialize range", ann._id);
                        }
                    }

                    if (mark) {
                        let top = mark.offsetTop;
                        let parent = mark.offsetParent as HTMLElement;
                        let limit = 0;
                        while (parent && parent !== articleRef.current && articleRef.current?.contains(parent) && limit < 50) {
                            top += parent.offsetTop;
                            parent = parent.offsetParent as HTMLElement;
                            limit++;
                        }

                        newPositions.push({
                            ...ann,
                            top
                        });
                    }
                } catch (err) {
                    console.error("Error processing annotation", ann._id, err);
                }
            });
        }

        // Handle General Document Note (Always at top, aligned with Title)
        let generalTop = 0;
        if (titleRef.current && articleRef.current) {
            const titleRect = titleRef.current.getBoundingClientRect();
            const articleRect = articleRef.current.getBoundingClientRect();
            // Calculate offset: How far up is the title from the article body?
            generalTop = titleRect.top - articleRect.top;
        }

        const generalAnnotation = relevantAnnotations.find(a => !a.range || a.range === "null");
        const placeholderGeneral = {
            _id: "general-placeholder",
            top: generalTop,
            comment: "",
            color: "#e5e7eb",
            isGeneral: true
        };

        if (generalAnnotation) {
            newPositions.push({ ...generalAnnotation, top: generalTop, isGeneral: true });
        } else {
            newPositions.push(placeholderGeneral);
        }

        // 2. Sort by Top Position, but FORCE General Note to be first
        newPositions.sort((a, b) => {
            if (a.isGeneral) return -1;
            if (b.isGeneral) return 1;
            return a.top - b.top;
        });

        // Assign Indices (0 for general, 1+ for others)
        let currentIndex = 1;
        const labeledPositions = newPositions.map((p) => {
            let index = 0;
            if (p.range && !p.isGeneral) { // Only increment for actual highlights
                index = currentIndex++;
                if (p._id.startsWith("temp-") === false) {
                    const mark = articleRef.current?.querySelector(`mark[data-annotation-id="${p._id}"]`) as HTMLElement;
                    if (mark) {
                        mark.setAttribute("data-annotation-index", String(index));
                    }
                }
            }
            return { ...p, index };
        });

        setPositionedAnnotations(labeledPositions);

    }, [annotations, doc._id]);

    // Layout Collision Detection (Measure rendered heights)
    const [visualOffsets, setVisualOffsets] = useState<Record<string, number>>({});

    useLayoutEffect(() => {
        if (positionedAnnotations.length === 0) return;

        const nodes = Array.from(document.querySelectorAll('.side-note-card')) as HTMLElement[];
        if (nodes.length === 0) return;

        let lastBottom = -Infinity; // Allow starting from negative positions (Title area)
        const newOffsets: Record<string, number> = {};
        let changed = false;

        // We assume nodes are rendered in order of positionedAnnotations (sorted by top)
        // But to be safe, let's map positionedAnnotations to nodes
        positionedAnnotations.forEach(ann => {
            const node = nodes.find(n => n.dataset.annotationId === ann._id);
            if (!node) return;

            const targetTop = ann.top;
            const height = node.offsetHeight;

            // Visual Top must be at least targetTop, but also below lastBottom + gap
            let visualTop = targetTop;
            if (visualTop < lastBottom + 15) {
                visualTop = lastBottom + 15;
            }

            if (visualTop !== visualOffsets[ann._id]) {
                changed = true;
            }

            newOffsets[ann._id] = visualTop;
            lastBottom = visualTop + height;
        });

        if (changed) {
            setVisualOffsets(newOffsets);
        }
    }, [positionedAnnotations, visualOffsets]);

    // Autosave & Global Click Handler
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const { activeAnnotation, editingComment, editingTags } = editingStateRef.current;

            // 1. Check for Autosave (Clicking outside popover)
            if (activeAnnotation && !target.closest(".annotation-popover")) {
                const isTemp = activeAnnotation.id.startsWith("temp-");
                // Only autosave non-temp notes to prevent crashes, or upsertGeneral handles temp
                if (!isTemp || activeAnnotation.id === "general-placeholder") {
                    performSave(activeAnnotation.id, editingComment, editingTags);
                }

                // Close if we clicked empty space
                if (!target.classList.contains("annotation-highlight") && !target.closest(".side-note-card")) {
                    setActiveAnnotation(null);
                    setEditingTags([]);
                }
            }
        };
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, []); // Empty dep array as we use ref

    // Handle Text Selection (Restored)
    useEffect(() => {
        const handleSelection = () => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                // Verify range is inside articleRef
                if (articleRef.current && articleRef.current.contains(range.commonAncestorContainer)) {
                    const rect = range.getBoundingClientRect();
                    setSelection({ range, rect });
                    return;
                }
            }
            setSelection(null);
        };

        // Debounce or just use proper events
        document.addEventListener("selectionchange", handleSelection);
        // Also listen to mouseup to be sure? selectionchange is usually enough but flaky on some browsers.
        // Actually selectionchange on document is best.
        return () => document.removeEventListener("selectionchange", handleSelection);
    }, []);

    // Reusable Submit Function (Updates State + Fetcher)
    const performSave = useCallback((id: string, comment: string, tags: string[]) => {
        const isGeneral = id === "general-placeholder" || id.startsWith("temp-general");

        // Optimistic Update
        const optimisticTags = [...tags];

        if (isGeneral) {
            const tempId = "temp-general-" + Date.now();
            const newAnn = {
                _id: tempId,
                documentId: doc._id,
                collectionName,
                range: null,
                text: "",
                color: "#e5e7eb",
                comment: comment,
                tags: optimisticTags,
                isGeneral: true
            };
            // Replace placeholder or add
            setAnnotations(prev => {
                // If we already have a temp general, replace it? Or just push.
                // Filter out old temp generals to avoid duplicates in optimistic state
                const filtered = prev.filter(a => !a.isGeneral || a.range);
                return [...filtered, newAnn];
            });

            annotationFetcher.submit({
                intent: "upsertGeneral",
                documentId: doc._id,
                collectionName,
                comment: comment,
                tags: JSON.stringify(optimisticTags)
            }, { method: "post", action: "/api/annotations" });

        } else {
            // Highlight Update
            if (id.startsWith("temp-")) return; // Guard against updating temp highlights

            setAnnotations(prev => prev.map(a => {
                if (a._id === id) {
                    return { ...a, comment: comment, tags: optimisticTags };
                }
                return a;
            }));

            annotationFetcher.submit({
                intent: "update",
                annotationId: id,
                comment: comment,
                tags: JSON.stringify(optimisticTags)
            }, { method: "post", action: "/api/annotations" });
        }
    }, [doc._id, collectionName]);

    // Cleanup old click handler logic if any remains.
    // We removed separate click handler for highlights? NO.
    // We still have `articleRef` handler for Highlight Clicks at line 442. -> SHOULD REMOVE IT if using global document click?
    // Actually, line 442 logic handles opening popover.
    // The previous implementation had `articleRef.current.addEventListener`.
    // My new `document` logic handles Close/Autosave.
    // I need to ensure they play nice.
    // If I click highlight:
    // 1. `document` listener (Autosave) -> saves OLD.
    // 2. `articleRef` listener (Open) -> opens NEW.
    // This order works.

    const saveGeneralNote = (comment: string) => {
        performSave("general-placeholder", comment, editingTags);
        setActiveAnnotation(null);
        setEditingTags([]);
    };

    const saveAnnotation = (color: string) => {
        if (!selection || !articleRef.current) return;



        const range = selection.range; // Keep ref before clearing

        const serialized = serializeRange(selection.range, articleRef.current);
        if (!serialized) return;
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
            if (entries[0].isIntersecting) {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(async () => {
                    let currentlyOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
                    if (currentlyOnline && 'connection' in navigator) {
                        const conn = (navigator as any).connection;
                        if (conn && conn.downlink === 0) {
                            currentlyOnline = false;
                        }
                    }

                    if (currentlyOnline) {
                        try {
                            await fetch(`/?_ping=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
                        } catch (e) {
                            currentlyOnline = false;
                        }
                    }

                    setIsOnline(currentlyOnline);

                    if (page < totalPages && currentlyOnline) {
                        const nextPage = page + 1;
                        fetcher.load(`?page=${nextPage}${searchTerm ? `&q=${searchTerm}` : ''}`);
                        setPage(nextPage);
                    }
                }, 300);
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
                    const ann = annotations.find(a => a._id === id);
                    if (ann) {
                        // Check if popover is already open for THIS annotation?
                        // If so, do nothing.
                        if (activeAnnotation?.id === id) return;

                        setEditingComment(ann.comment || "");
                        setEditingTags(ann.tags || []);
                        setActiveAnnotation({
                            id,
                            rect: target.getBoundingClientRect()
                        });
                        setSelection(null); // Clear text selection toolbar
                        e.stopPropagation(); // Prevent other clicks
                    }
                }
            }
            // Removed logic for closing popover (handled by global autosave)
        };

        if (articleRef.current) {
            articleRef.current.addEventListener("click", handleClick);
        }
        return () => {
            articleRef.current?.removeEventListener("click", handleClick);
        };
    }, [annotations, activeAnnotation]); // Added activeAnnotation dep to check current open

    // 6. Update updateComment to call performSave
    const updateComment = () => {
        if (!activeAnnotation) return;
        performSave(activeAnnotation.id, editingComment, editingTags);
        setActiveAnnotation(null);
        setEditingTags([]);
    };

    const handleSave = () => {
        if (activeAnnotation?.id.startsWith("temp-") && activeAnnotation.id !== "general-placeholder" && !activeAnnotation.id.startsWith("temp-general")) {
            // Prevent manual save of temp highlights? Actually allow it if user wants?
            // But performSave guards it.
            return;
        }

        if (activeAnnotation?.id === "general-placeholder" || activeAnnotation?.id.startsWith("temp-general")) {
            performSave("general-placeholder", editingComment, editingTags); // Explicitly mark as general
            setActiveAnnotation(null);
            setEditingTags([]);
        } else {
            updateComment();
        }
    }

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
                parent.normalize(); // Fix fragmented text nodes that break selection
            }
        });

        setActiveAnnotation(null);
    };

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [matchesMobile, setMatchesMobile] = useState(false); // Helper to track if we are on mobile
    const [enableTransitions, setEnableTransitions] = useState(false); // State to delay transitions until after restore
    const sidebarRef = useRef<HTMLElement>(null);
    const toggleButtonRef = useRef<HTMLButtonElement>(null);

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

    // Click outside to close sidebar
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isSidebarOpen &&
                sidebarRef.current &&
                !sidebarRef.current.contains(event.target as Node) &&
                toggleButtonRef.current &&
                !toggleButtonRef.current.contains(event.target as Node)) {
                toggleSidebar(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isSidebarOpen]);

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

    const mediaBase = "file:///H:/My Drive/Scraper/media";
    const mediaUrl = (filename: string) => `${mediaBase}/${source}/${collectionName}/${filename}`;

    const schemaData = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": doc.article?.title || "Untitled Document",
        "alternativeHeadline": doc.article?.subtitle,
        "description": doc.article?.subtitle,
        "datePublished": doc.article?.post_date ? new Date(doc.article.post_date).toISOString() : undefined,
        "keywords": docStatus.tags ? docStatus.tags.join(", ") : undefined,
        "audience": doc.article?.audience,
        "author": [{
            "@type": "Person",
            "name": collectionName
        }],
        "publisher": {
            "@type": "Organization",
            "name": "Tony's File Cabinet"
        },
        "url": source === "ghost" ? doc.article?.url : doc.article?.canonical_url,

        // Split Media Fields
        // PDF -> encoding
        ...(doc.pdf ? {
            "encoding": {
                "@type": "MediaObject",
                "contentUrl": mediaUrl(doc.pdf),
                "encodingFormat": "application/pdf",
                "name": "PDF"
            }
        } : {}),

        // Video -> video
        ...(doc.video ? {
            "video": {
                "@type": "VideoObject",
                "contentUrl": mediaUrl(doc.video),
                "name": "Video",
                "uploadDate": doc.article?.post_date
            }
        } : {}),

        // Audio -> audio
        ...(doc.audio ? {
            "audio": {
                "@type": "AudioObject",
                "contentUrl": mediaUrl(doc.audio),
                "name": "Audio",
                "uploadDate": doc.article?.post_date
            }
        } : {}),

        // Generic Media -> associatedMedia
        ...(doc.media && doc.media.length > 0 ? {
            "associatedMedia": doc.media.map((m: string) => ({
                "@type": "MediaObject",
                "contentUrl": mediaUrl(m),
                "name": "Media"
            })),
            // Flat list for easier template looping: {{#each schema:mediaUrl}} {{this}} {{/each}} // doesn't seem to work
            "mediaUrl": doc.media.map((m: string) => mediaUrl(m))
        } : {})
    };


    return (
        <div className="min-h-screen bg-white font-sans flex flex-col md:flex-row relative">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaData) }} />
            {/* Mobile/Collapsed Toggle Button */}
            <button
                ref={toggleButtonRef}
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
                    h-screen md:h-[calc(100vh-3rem)] overflow-hidden fixed top-0 md:top-12 left-0
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
                                            <span className="truncate flex-1">{d.title}</span>
                                            <span className="flex items-center gap-1 shrink-0">
                                                {(d as any).read && <span title="Read" className="text-xs">✅</span>}
                                                {(d as any).liked && <span title="Liked" className="text-xs">❤️</span>}
                                            </span>
                                        </span>
                                        <div className="flex flex-wrap items-center gap-2 mt-1">
                                            {d.date && (
                                                <span className="block text-xs text-gray-400">
                                                    {new Date(d.date).toLocaleDateString()}
                                                </span>
                                            )}
                                            {(d as any).tags && (d as any).tags.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {(d as any).tags.map((tag: string, i: number) => (
                                                        <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>

                    {
                        !isOnline && (
                            <div className="text-amber-600 bg-amber-50 px-3 py-1 rounded-full text-sm font-medium border border-amber-200 mb-2 text-center mx-4">
                                You are currently offline. Pages cannot be loaded.
                            </div>
                        )
                    }
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
            <div className={`flex-1 order-1 md:order-2 bg-white min-h-screen p-4 flex flex-col items-center print:overflow-visible transition-opacity duration-300 ${isSidebarOpen ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="max-w-[1600px] w-full transition-all duration-300 print:max-w-none print:w-full">

                    <main className="px-6 pb-20 print:pb-0">
                        {/* Unified Article Wrapper (Target for Annotations) */}
                        <div ref={articleRef} className="relative group mx-auto print:mx-0 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_800px_minmax(0,1fr)] lg:gap-12 print:grid print:grid-cols-[minmax(0,1fr)_200px] print:gap-6 max-w-[1150px] md:max-w-[800px] lg:max-w-[1150px] 2xl:max-w-none print:max-w-none">

                            {/* Content Column */}
                            <div className="lg:min-w-0 2xl:col-start-2">
                                {/* Header Section (Now Annotatable) */}
                                <header className="pt-12 pb-8">
                                    <p className="text-blue-600 mb-4 inline-block font-medium">
                                        {collectionName}
                                    </p>
                                    <h1 ref={titleRef} className="text-4xl font-bold text-gray-900 leading-tight mb-2">
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

                                    {/* Link Tags Row */}
                                    <div className="flex flex-wrap items-center gap-2 mb-4">
                                        {docStatus.tags && docStatus.tags.map((tag: string, i: number) => (
                                            <span key={i} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200">
                                                {tag}
                                                <button
                                                    onClick={() => removeTag(tag)}
                                                    className="ml-1.5 text-gray-400 hover:text-red-500 focus:outline-none print:hidden"
                                                    title="Remove tag"
                                                >
                                                    &times;
                                                </button>
                                            </span>
                                        ))}
                                        <div className="relative print:hidden">
                                            <input
                                                type="text"
                                                placeholder="+ Tag"
                                                className="w-20 text-xs border border-gray-300 bg-white text-gray-900 rounded-full px-3 py-1.5 focus:w-32 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all placeholder-gray-500 shadow-sm"
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === ",") {
                                                        e.preventDefault();
                                                        const val = (e.target as HTMLInputElement).value.trim();
                                                        if (val) {
                                                            addTag(val);
                                                            (e.target as HTMLInputElement).value = "";
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-gray-500 text-sm border-t border-gray-100 pt-4 mt-4">
                                        <div>
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
                                        <div className="flex items-center gap-4">
                                            <button
                                                onClick={() => toggleStatus('read')}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 text-gray-900 bg-white hover:bg-gray-50 transition-colors"
                                            >
                                                <span>
                                                    {docStatus.read ? "✅" : (
                                                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" opacity="0" /> {/* Hidden check for sizing/visual consistency if needed, or just a box */}
                                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
                                                        </svg>
                                                    )}
                                                </span>
                                                <span className="font-medium">Read</span>
                                            </button>
                                            <button
                                                onClick={() => toggleStatus('liked')}
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 text-gray-900 bg-white hover:bg-gray-50 transition-colors"
                                            >
                                                <span>{docStatus.liked ? "❤️" : "♡"}</span>
                                                <span className="font-medium">Liked</span>
                                            </button>

                                            {/* Print Views (Buttons are hidden by global CSS) */}
                                            <div className="hidden print:flex items-center gap-4">
                                                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 text-gray-900 bg-white">
                                                    <span>
                                                        {docStatus.read ? "✅" : (
                                                            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth="2" />
                                                            </svg>
                                                        )}
                                                    </span>
                                                    <span className="font-medium">Read</span>
                                                </span>
                                                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 text-gray-900 bg-white">
                                                    <span>{docStatus.liked ? "❤️" : "♡"}</span>
                                                    <span className="font-medium">Liked</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Media Section */}
                                    {(doc.pdf || doc.video || doc.audio || (doc.media && doc.media.length > 0)) && (
                                        <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-100">
                                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">Media Files</h3>
                                            <div className="space-y-2 text-sm text-gray-700">
                                                {doc.pdf && (
                                                    <MediaLink label="PDF" filename={doc.pdf} collectionName={collectionName} source={source} />
                                                )}
                                                {doc.video && (
                                                    <MediaLink label="Video" filename={doc.video} collectionName={collectionName} source={source} />
                                                )}
                                                {doc.audio && (
                                                    <MediaLink label="Audio" filename={doc.audio} collectionName={collectionName} source={source} />
                                                )}
                                                {doc.media?.map((m: string, i: number) => (
                                                    <MediaLink key={i} label="Media" filename={m} collectionName={collectionName} source={source} />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </header>

                                {/* Article Body */}
                                {doc.article?.body_html ? (
                                    <ArticleContent html={doc.article.body_html} />
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
                                    <section className="mt-16 border-t border-gray-100 pt-10 break-inside-avoid max-w-[800px] mx-auto print:mx-0">
                                        <h3 className="text-2xl font-bold text-gray-900 mb-8">Comments</h3>
                                        <div className="space-y-8">
                                            {(doc.comments?.comments || doc.article?.comments || []).map((comment: any) => (
                                                <Comment key={comment.id} comment={comment} />
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </div>

                            {/* Side Notes (Cliff Notes) - Desktop & Print */}
                            <div className="hidden lg:block print:block relative w-full 2xl:w-[300px] h-full pointer-events-none 2xl:col-start-3">
                                {positionedAnnotations.map(ann => {
                                    const isGeneral = ann.isGeneral;
                                    return (
                                        <div
                                            key={ann._id}
                                            data-annotation-id={ann._id}
                                            className={`side-note-card left-0 w-full p-3 bg-white border border-gray-100 shadow-sm rounded-lg text-sm group-hover/note:shadow-md transition-all duration-300 pointer-events-auto cursor-pointer flex gap-3 print:border-gray-300 print:shadow-none bg-white ${isGeneral ? "sticky top-24 z-50 print:!absolute print:!top-[var(--print-top)] print:!mt-0" : "absolute"}`}
                                            style={{
                                                borderLeft: `4px solid ${ann.color || '#fef9c3'}`,
                                                ...(isGeneral
                                                    ? {
                                                        // Removed marginTop hack; aligned with top of wrapper (Header) by default
                                                        "--print-top": `${visualOffsets[ann._id] ?? ann.top}px`
                                                    } as any
                                                    : { top: `${visualOffsets[ann._id] ?? ann.top}px` }
                                                )
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveAnnotation({ id: ann._id, rect: (e.target as HTMLElement).getBoundingClientRect() });
                                                setEditingComment(ann.comment || "");
                                                setEditingTags(ann.tags || []);
                                            }}
                                        >
                                            {!ann.isGeneral && (
                                                <div className="flex-shrink-0 font-bold text-gray-400 select-none">
                                                    {ann.index}
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                {/* Only show tags for General Note (Index 0) */}
                                                {/* REMOVED TAGS FROM SIDE NOTE */}
                                                {(ann.isGeneral || !ann.range) && (/* Nothing here now */ null)}
                                                {ann.comment ? (
                                                    <div className="text-gray-800 min-w-0 break-words">{ann.comment}</div>
                                                ) : (
                                                    <div className="text-gray-400 italic text-xs">
                                                        {ann.isGeneral ? "Add a general note..." : "No comment"}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                        </div>
                    </main>

                    {/* Floating Selection Toolbar */}
                    {selection && (
                        <div
                            style={{
                                position: 'fixed',
                                top: `${selection.rect.top - 40}px`,
                                left: `${selection.rect.left}px`,
                                zIndex: 50
                            }}
                            className="bg-white shadow-xl rounded-lg border border-gray-200 p-1 flex gap-1 print:hidden"
                        >
                            <button onClick={() => saveAnnotation("#fef9c3")} className="w-6 h-6 rounded-full bg-[#fef9c3] hover:scale-110 transition-transform border border-gray-200" title="Yellow"></button>
                            <button onClick={() => saveAnnotation("#dcfce7")} className="w-6 h-6 rounded-full bg-[#dcfce7] hover:scale-110 transition-transform border border-gray-200" title="Green"></button>
                            <button onClick={() => saveAnnotation("#fce7f3")} className="w-6 h-6 rounded-full bg-[#fce7f3] hover:scale-110 transition-transform border border-gray-200" title="Pink"></button>
                        </div>
                    )}

                    {/* Popover */}
                    {activeAnnotation && (() => {
                        const currentAnn = annotations.find(a => a._id === activeAnnotation.id);
                        const isGeneral = activeAnnotation.id === "general-placeholder" || (currentAnn && (!currentAnn.range || (currentAnn as any).isGeneral));

                        return (
                            <div
                                className="annotation-popover fixed z-50 bg-white shadow-2xl rounded-lg border border-gray-200 p-4 w-80 ring-1 ring-gray-900/5"
                                style={{
                                    top: `${activeAnnotation.rect.bottom + 10}px`,
                                    left: `${Math.min(window.innerWidth - 320, Math.max(10, activeAnnotation.rect.left))}px`
                                }}
                            >
                                <h4 className="font-bold text-gray-800 mb-2 text-sm">
                                    {isGeneral ? "General Note" : "Annotation"}
                                </h4>

                                {isGeneral && (
                                    <div className="mb-3">
                                        {/* REMOVED TAG INPUT FROM GENERAL NOTE POPOVER */}
                                    </div>
                                )}
                                <textarea
                                    className="w-full border border-gray-300 rounded-md p-3 text-sm mb-3 min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none bg-gray-50 focus:bg-white transition-colors text-gray-900"
                                    placeholder="Write your comment here..."
                                    value={editingComment}
                                    onChange={(e) => setEditingComment(e.target.value)}
                                    autoFocus
                                />
                                <div className="flex justify-between items-center">
                                    {isGeneral ? (
                                        <button
                                            onClick={() => {
                                                setEditingComment("");
                                                setEditingTags([]);
                                            }}
                                            className="text-gray-500 text-xs hover:underline"
                                        >
                                            Clear
                                        </button>
                                    ) : (
                                        <button
                                            onClick={deleteAnnotation}
                                            className="text-red-500 text-xs hover:underline"
                                        >
                                            Delete
                                        </button>
                                    )}

                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div >
        </div >
    );
}
