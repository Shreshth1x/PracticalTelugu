import type { Metadata } from "next";
import PalukuApp from "./PalukuApp";

export const metadata: Metadata = {
  title: "PalukuLingo — Telugu that feels close to home",
  description:
    "Practical Telugu essentials and a friendly full course, guided by Mayu the peacock.",
};

export default function Home() {
  return <PalukuApp />;
}
