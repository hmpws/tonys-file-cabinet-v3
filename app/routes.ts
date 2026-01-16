import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("collections/:name", "routes/collections.$name.tsx"),
    route("collections/:name/:id", "routes/collections.$name.$id.tsx"),
    route("login", "routes/login.tsx"),
    route("logout", "routes/logout.tsx"),
    route("api/annotations", "routes/api.annotations.ts"),
] satisfies RouteConfig;
