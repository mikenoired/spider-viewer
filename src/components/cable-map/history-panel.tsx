"use client";

import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
	CalendarDaysIcon,
	DownloadIcon,
	LoaderCircleIcon,
	RefreshCcwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	downloadBackdatedDocx,
	getBackdatedHistory,
	getHistory,
} from "@/lib/cable-map/functions";
import type { DateRangeInput, HistoryEntryView } from "@/lib/cable-map/shared";

function formatRangeLabel(range?: DateRange) {
	if (!range?.from) {
		return "Выбрать диапазон";
	}

	if (!range.to) {
		return format(range.from, "d MMM yyyy", { locale: ru });
	}

	return `${format(range.from, "d MMM yyyy", { locale: ru })} — ${format(
		range.to,
		"d MMM yyyy",
		{ locale: ru },
	)}`;
}

function dateToIso(value: Date | undefined) {
	return value ? format(value, "yyyy-MM-dd") : null;
}

function formatTimestamp(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

export function HistoryPanel({
	title,
	description,
	initialEntries,
	backdatedOnly,
}: {
	title: string;
	description: string;
	initialEntries: HistoryEntryView[];
	backdatedOnly?: boolean;
}) {
	const [entries, setEntries] = useState(initialEntries);
	const [pending, setPending] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [range, setRange] = useState<DateRange | undefined>();
	const hasRange = Boolean(range?.from || range?.to);

	const rangePayload = useMemo(
		() =>
			({
				from: dateToIso(range?.from),
				to: dateToIso(range?.to),
			}) satisfies DateRangeInput,
		[range],
	);

	async function reloadEntries(nextRange: DateRangeInput) {
		setPending(true);

		try {
			const nextEntries = backdatedOnly
				? await getBackdatedHistory({
						data: nextRange,
					})
				: await getHistory({
						data: nextRange,
					});

			setEntries(nextEntries);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Не удалось загрузить историю изменений.",
			);
		} finally {
			setPending(false);
		}
	}

	async function handleExport() {
		setExporting(true);

		try {
			const response = await downloadBackdatedDocx({
				data: {
					...rangePayload,
					fileName: "backdated-history.docx",
				},
			});

			if (!(response instanceof Response)) {
				throw new Error("Сервер вернул неожиданный ответ при экспорте.");
			}

			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = objectUrl;
			link.download = "backdated-history.docx";
			link.click();
			URL.revokeObjectURL(objectUrl);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Не удалось выгрузить docx-отчёт.",
			);
		} finally {
			setExporting(false);
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
				<div className="flex flex-col gap-1">
					<CardTitle>{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Popover>
						<PopoverTrigger asChild>
							<Button type="button" variant="outline">
								<CalendarDaysIcon data-icon="inline-start" />
								{formatRangeLabel(range)}
							</Button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-auto">
							<PopoverHeader>
								<PopoverTitle>Диапазон дат</PopoverTitle>
							</PopoverHeader>
							<Calendar
								mode="range"
								numberOfMonths={2}
								selected={range}
								onSelect={(value) => setRange(value)}
							/>
						</PopoverContent>
					</Popover>

					<Button
						type="button"
						variant="outline"
						onClick={() => reloadEntries(rangePayload)}
						disabled={pending}
					>
						{pending ? (
							<LoaderCircleIcon
								data-icon="inline-start"
								className="animate-spin"
							/>
						) : (
							<RefreshCcwIcon data-icon="inline-start" />
						)}
						Применить
					</Button>

					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setRange(undefined);
							void reloadEntries({
								from: null,
								to: null,
							});
						}}
						disabled={!hasRange || pending}
					>
						Сбросить
					</Button>

					{backdatedOnly ? (
						<Button type="button" onClick={handleExport} disabled={exporting}>
							{exporting ? (
								<LoaderCircleIcon
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : (
								<DownloadIcon data-icon="inline-start" />
							)}
							Выгрузить DOCX
						</Button>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Изменено</TableHead>
							<TableHead>Дата действия</TableHead>
							<TableHead>Пользователь</TableHead>
							<TableHead>Помещение</TableHead>
							<TableHead>Было</TableHead>
							<TableHead>Стало</TableHead>
							<TableHead>Тип</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{entries.length > 0 ? (
							entries.map((entry) => (
								<TableRow key={entry.id}>
									<TableCell>{formatTimestamp(entry.changedAt)}</TableCell>
									<TableCell>{entry.effectiveDate}</TableCell>
									<TableCell>{entry.userLogin}</TableCell>
									<TableCell className="font-medium">
										{entry.roomName}
									</TableCell>
									<TableCell>{entry.oldProgress}%</TableCell>
									<TableCell>{entry.newProgress}%</TableCell>
									<TableCell>
										{entry.isBackdated ? (
											<Badge variant="destructive">Задним числом</Badge>
										) : (
											<Badge variant="secondary">Обычное</Badge>
										)}
									</TableCell>
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={7}
									className="h-32 text-center text-muted-foreground"
								>
									За выбранный период записей не найдено.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
