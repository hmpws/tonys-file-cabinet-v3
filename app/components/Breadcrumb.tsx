import { Link, useLocation, useMatches } from "react-router";

// Helper interface for our route data
interface RouteData {
    doc?: {
        _id: string;
        article?: {
            title?: string;
        };
    };
}

export function Breadcrumb() {
    const location = useLocation();
    const matches = useMatches();
    const pathnames = location.pathname.split("/").filter((x) => x);

    const getBreadcrumbName = (value: string) => {
        // Check if this value corresponds to a loaded document ID in the active routes
        const lastMatch = matches[matches.length - 1];

        // We safely check if data exists and matches our expected structure
        const data = lastMatch?.data as RouteData | undefined;

        if (String(data?.doc?._id) === value && data?.doc?.article?.title) {
            return data.doc.article.title;
        }

        return decodeURIComponent(value);
    };

    return (
        <nav className="flex py-3 px-5 text-gray-700 bg-gray-50 border-b border-gray-200" aria-label="Breadcrumb">
            <ol className="inline-flex items-center space-x-1 md:space-x-3">
                <li className="inline-flex items-center">
                    <Link
                        to="/"
                        className="inline-flex items-center text-sm font-medium text-gray-700 hover:text-blue-600 dark:text-gray-400 dark:hover:text-white"
                    >
                        <svg
                            className="w-3 h-3 mr-2.5"
                            aria-hidden="true"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                        >
                            <path d="m19.707 9.293-2-2-7-7a1 1 0 0 0-1.414 0l-7 7-2 2a1 1 0 0 0 1.414 1.414L2 10.414V18a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7.586l.293.293a1 1 0 0 0 1.414-1.414Z" />
                        </svg>
                        Home
                    </Link>
                </li>
                {pathnames.map((value, index) => {
                    if (value === "collections") return null;

                    const to = `/${pathnames.slice(0, index + 1).join("/")}`;
                    const isLast = index === pathnames.length - 1;

                    return (
                        <li key={to}>
                            <div className="flex items-center">
                                <svg
                                    className="w-3 h-3 text-gray-400 mx-1"
                                    aria-hidden="true"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 6 10"
                                >
                                    <path
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth="2"
                                        d="m1 9 4-4-4-4"
                                    />
                                </svg>
                                {isLast ? (
                                    <span className="ml-1 text-sm font-medium text-gray-500 md:ml-2 dark:text-gray-400 truncate max-w-[200px] md:max-w-xs">
                                        {getBreadcrumbName(value)}
                                    </span>
                                ) : (
                                    <Link
                                        to={to}
                                        className="ml-1 text-sm font-medium text-gray-700 hover:text-blue-600 md:ml-2 dark:text-gray-400 dark:hover:text-white"
                                    >
                                        {getBreadcrumbName(value)}
                                    </Link>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
