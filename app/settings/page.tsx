import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Settings · PalukuLingo",
  description:
    "Choose how Telugu script, pronunciation, audio, and local progress behave.",
};

export default function SettingsPage() {
  return <PalukuApp screen="settings" />;
}
