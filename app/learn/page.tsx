import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Situations | PalukuLingo",
  description:
    "Choose a real-life Telugu situation and practice the phrases you need now.",
};

export default function LearnPage() {
  return <PalukuApp screen="learn" />;
}
