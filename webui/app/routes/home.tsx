import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "tariorg - Dashboard" },
    {
      name: "description",
      content:
        "Create, govern, and coordinate decentralized organizations on Tari.",
    },
  ];
}

export default function Home() {
  return <Welcome />;
}
