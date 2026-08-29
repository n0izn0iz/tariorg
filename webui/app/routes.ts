import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("/", "./navigation.tsx", [
    index("routes/home.tsx"),
    route("/new-org", "routes/new-org.tsx"),
    route("/org/:id", "routes/org.tsx"),
  ]),
] satisfies RouteConfig;
