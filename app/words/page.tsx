import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Words · PalukuLingo",
  description:
    "Hear, search, and save the Telugu words you want to keep nearby.",
};

export default function WordsPage() {
  return <PalukuApp screen="words" />;
}
