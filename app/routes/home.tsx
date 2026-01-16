import { useState } from "react";
import type { Route } from "./+types/home";
import { Link, Form } from "react-router";
import clientPromise from "../db.server";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Tony's File Cabinet" },
    { name: "description", content: "Welcome to Tony's File Cabinet!" },
  ];
}

import { requireUser } from "../sessions.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const client = await clientPromise;
  const db = client.db("substack");
  const collectionsList = await db.listCollections().toArray();
  collectionsList.sort((a, b) => a.name.localeCompare(b.name));

  const collections = await Promise.all(
    collectionsList.map(async (c) => {
      const doc = await db.collection(c.name).findOne({}, { sort: { "article.post_date": -1 }, projection: { "article.post_date": 1 } });
      const lastFetched = doc?.article?.post_date || null;
      return {
        name: c.name,
        lastFetched
      };
    })
  );

  return { collections: collections.filter((c) => c.name !== "annotations") };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { collections } = loaderData;
  const [searchTerm, setSearchTerm] = useState("");

  const filteredCollections = collections.filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 font-sans p-4">
      <div className="max-w-2xl w-full bg-white shadow-lg rounded-xl overflow-hidden">
        <header className="bg-blue-600 text-white p-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Tony's File Cabinet</h1>
            <p className="mt-2 text-blue-100">Browse collections</p>
          </div>
          <Form action="/logout" method="post">
            <button type="submit" className="bg-blue-700 hover:bg-blue-800 text-white font-bold py-2 px-4 rounded transition-colors text-sm">
              Logout
            </button>
          </Form>
        </header>

        <main className="p-6">
          <div className="mb-6">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <svg className="w-4 h-4 text-gray-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 20">
                  <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 19-4-4m0-7A7 7 0 1 1 1 8a7 7 0 0 1 14 0Z" />
                </svg>
              </div>
              <input
                type="search"
                className="block w-full p-4 pl-10 text-sm text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500 hover:border-gray-400 transition-colors"
                placeholder="Search collections..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {filteredCollections.length === 0 ? (
            <p className="text-gray-500 italic">No collections found matching "{searchTerm}".</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1">
              {filteredCollections.map((c) => (
                <li
                  key={c.name}
                  className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors duration-200 group"
                >
                  <Link to={`/collections/${c.name}`} className="block w-full h-full py-4 px-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-lg font-medium text-gray-800 group-hover:text-blue-600 transition-colors">
                          {c.name}
                        </span>
                        {c.lastFetched && (
                          <span className="text-sm text-gray-400">
                            {new Date(c.lastFetched).toLocaleDateString("en-US", {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })}
                          </span>
                        )}
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
        </main>


      </div>
    </div>
  );
}
