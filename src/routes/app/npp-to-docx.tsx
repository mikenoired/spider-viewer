import { createFileRoute } from "@tanstack/react-router";

import { NppConverterPanel } from "@/components/npp/npp-converter-panel";

export const Route = createFileRoute("/app/npp-to-docx")({
	component: NppToDocxPage,
});

function NppToDocxPage() {
	return <NppConverterPanel />;
}
