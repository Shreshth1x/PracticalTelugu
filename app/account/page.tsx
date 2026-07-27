import type { Metadata } from "next";
import { AccountPage } from "./AccountPage";

export const metadata: Metadata = {
  title: "Account | PracticalTelugu",
  description:
    "Keep your PracticalTelugu progress and saved phrases on every device.",
};

export default function Page() {
  return <AccountPage />;
}
