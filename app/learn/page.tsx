import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Learn · PalukuLingo",
  description:
    "Choose Telugu Essentials or learn Telugu from the beginning, one useful topic at a time.",
};

export default function LearnPage() {
  return <PalukuApp screen="learn" />;
}
