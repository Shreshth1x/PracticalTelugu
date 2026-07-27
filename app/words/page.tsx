import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Phrasebook | PracticalTelugu",
  description:
    "Search, hear, and save practical Telugu for the moments you actually face.",
};

export default function WordsPage() {
  return <PalukuApp screen="words" />;
}
