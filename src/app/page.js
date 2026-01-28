"use client";

import dynamic from "next/dynamic";

const Geoportal = dynamic(() => import("../components/Geoportal"), {
  ssr: false,
});

export default function Home() {
  return <Geoportal />;
}
