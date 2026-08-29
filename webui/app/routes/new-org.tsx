import type { Route } from "./+types/new-org";
import { NewOrgForm } from "~/components/NewOrgForm";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "tariorg - Create Organization" },
    {
      name: "description",
      content: "Create a new decentralized organization on Tari.",
    },
  ];
}

export default function NewOrg() {
  return <NewOrgForm />;
}
