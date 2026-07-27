import type { Metadata } from "next";
import PalukuApp from "../PalukuApp";

export const metadata: Metadata = {
  title: "Settings | PracticalTelugu",
  description:
    "Choose pronunciation, audio, and quick-practice preferences.",
};

export default function SettingsPage() {
  return <PalukuApp screen="settings" />;
}
