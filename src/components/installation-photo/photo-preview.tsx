"use client";

import { useEffect, useState } from "react";

export function PhotoPreview({ image, fileName }: { image: Blob; fileName: string }) {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		const nextUrl = URL.createObjectURL(image);

		setUrl(nextUrl);

		return () => URL.revokeObjectURL(nextUrl);
	}, [image]);

	if (!url) {
		return <div className="aspect-[4/3] rounded-lg border bg-muted" />;
	}

	return (
		<img
			src={url}
			alt={fileName}
			className="aspect-[4/3] w-full rounded-lg border object-cover"
			loading="lazy"
		/>
	);
}
