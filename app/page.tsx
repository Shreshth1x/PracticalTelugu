import type { Metadata } from "next";
import PalukuApp from "./PalukuApp";

export const metadata: Metadata = {
  title: "Today · PalukuLingo",
  description:
    "Meet five useful Telugu words and continue your course with Mayu.",
};

export default function Home() {
  return <PalukuApp screen="today" />;
}
