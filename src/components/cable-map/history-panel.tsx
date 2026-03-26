"use client";

import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
	ArrowDownIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	CalendarDaysIcon,
	Clock3Icon,
	DownloadIcon,
	FolderIcon,
	LoaderCircleIcon,
	PercentIcon,
	RefreshCcwIcon,
	TagIcon,
	UserIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
	downloadBackdatedDocx,
	downloadHistoryDocx,
	getBackdatedHistory,
	getHistory,
} from "@/lib/cable-map/functions";
import type { DateRangeInput, HistoryEntryView } from "@/lib/cable-map/shared";
import { cn, downloadResponseFile } from "@/lib/utils";

function formatRangeLabel(range?: DateRange) {
	if (!range?.from) {
		return "Сегодня";
	}

	if (!range.to || dateToIso(range.from) === dateToIso(range.to)) {
		return format(range.from, "d MMM yyyy", { locale: ru });
	}

	return `${format(range.from, "d MMM yyyy", { locale: ru })} — ${format(range.to, "d MMM yyyy", {
		locale: ru,
	})}`;
}

function dateToIso(value: Date | undefined) {
	return value ? format(value, "yyyy-MM-dd") : null;
}

function buildExportFileName(range: DateRangeInput, backdatedOnly?: boolean) {
	const suffix =
		range.from && range.to
			? range.from === range.to
				? range.from
				: `${range.from}_${range.to}`
			: (range.from ?? range.to ?? format(new Date(), "yyyy-MM-dd"));

	return `${backdatedOnly ? "backdated-history" : "history-levels"}-${suffix}.docx`;
}

function createTodayRange(): DateRange {
	const today = new Date();

	return {
		from: today,
		to: today,
	};
}

function formatTimestamp(value: string) {
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

type SortKey =
	| "changedAt"
	| "effectiveDate"
	| "userLogin"
	| "roomName"
	| "oldProgress"
	| "newProgress"
	| "isBackdated";

type SortDirection = "asc" | "desc";

const sortableColumns: Array<{
	key: SortKey;
	label: string;
	icon: typeof Clock3Icon;
}> = [
	{ key: "changedAt", label: "Изменено", icon: Clock3Icon },
	{ key: "effectiveDate", label: "Дата действия", icon: CalendarDaysIcon },
	{ key: "userLogin", label: "Пользователь", icon: UserIcon },
	{ key: "roomName", label: "Помещение", icon: FolderIcon },
	{ key: "oldProgress", label: "Было", icon: PercentIcon },
	{ key: "newProgress", label: "Стало", icon: PercentIcon },
	{ key: "isBackdated", label: "Тип", icon: TagIcon },
];

function compareEntries(
	left: HistoryEntryView,
	right: HistoryEntryView,
	key: SortKey,
	direction: SortDirection
) {
	const factor = direction === "asc" ? 1 : -1;

	switch (key) {
		case "changedAt":
			return (new Date(left.changedAt).getTime() - new Date(right.changedAt).getTime()) * factor;
		case "effectiveDate":
			return (
				left.effectiveDate.localeCompare(right.effectiveDate, "ru", {
					numeric: true,
				}) * factor
			);
		case "userLogin":
			return (
				left.userLogin.localeCompare(right.userLogin, "ru", {
					numeric: true,
					sensitivity: "base",
				}) * factor
			);
		case "roomName":
			return (
				left.roomName.localeCompare(right.roomName, "ru", {
					numeric: true,
					sensitivity: "base",
				}) * factor
			);
		case "oldProgress":
			return (left.oldProgress - right.oldProgress) * factor;
		case "newProgress":
			return (left.newProgress - right.newProgress) * factor;
		case "isBackdated":
			return (Number(left.isBackdated) - Number(right.isBackdated)) * factor;
	}
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
	if (!active) {
		return <ArrowUpDownIcon className="text-muted-foreground/70" />;
	}

	return direction === "asc" ? (
		<ArrowUpIcon className="text-foreground" />
	) : (
		<ArrowDownIcon className="text-foreground" />
	);
}

export function HistoryPanel({
	description,
	initialEntries,
	backdatedOnly,
}: {
	description: string;
	initialEntries: HistoryEntryView[];
	backdatedOnly?: boolean;
}) {
	const [entries, setEntries] = useState(initialEntries);
	const [pending, setPending] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [range, setRange] = useState<DateRange>(createTodayRange);
	const [sortKey, setSortKey] = useState<SortKey>("changedAt");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
	const [isCompact, setIsCompact] = useState(false);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(max-width: 767px)");
		const updateIsCompact = () => setIsCompact(mediaQuery.matches);

		updateIsCompact();
		mediaQuery.addEventListener("change", updateIsCompact);

		return () => mediaQuery.removeEventListener("change", updateIsCompact);
	}, []);

	const rangePayload = useMemo(
		() =>
			({
				from: dateToIso(range?.from),
				to: dateToIso(range?.to),
			}) satisfies DateRangeInput,
		[range]
	);
	const sortedEntries = useMemo(
		() => [...entries].sort((left, right) => compareEntries(left, right, sortKey, sortDirection)),
		[entries, sortDirection, sortKey]
	);

	function handleSort(nextKey: SortKey) {
		if (sortKey === nextKey) {
			setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
			return;
		}

		setSortKey(nextKey);
		setSortDirection(nextKey === "changedAt" ? "desc" : "asc");
	}

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
			toast.error(error instanceof Error ? error.message : "Не удалось загрузить историю изменений.");
		} finally {
			setPending(false);
		}
	}

	async function handleExport() {
		setExporting(true);

		try {
			const fileName = buildExportFileName(rangePayload, backdatedOnly);
			const response = backdatedOnly
				? await downloadBackdatedDocx({
						data: {
							...rangePayload,
							fileName,
						},
					})
				: await downloadHistoryDocx({
						data: {
							...rangePayload,
							fileName,
						},
					});

			if (!(response instanceof Response)) {
				throw new Error("Сервер вернул неожиданный ответ при экспорте.");
			}

			await downloadResponseFile(response, fileName);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось выгрузить docx-отчёт.");
		} finally {
			setExporting(false);
		}
	}

	return (
		<Card className="border-none rounded-none ring-0 px-0 flex-1">
			<CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
				<div className="flex flex-col gap-1">
					<CardDescription>{description}</CardDescription>
				</div>

				<div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
					<Popover>
						<PopoverTrigger asChild>
							<Button
								type="button"
								variant="outline"
								className="h-10 w-full justify-between sm:h-8 sm:w-auto sm:justify-center">
								<CalendarDaysIcon data-icon="inline-start" />
								{formatRangeLabel(range)}
							</Button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
							<PopoverHeader>
								<PopoverTitle>Диапазон дат</PopoverTitle>
							</PopoverHeader>
							<Calendar
								mode="range"
								numberOfMonths={isCompact ? 1 : 2}
								selected={range}
								onSelect={(value) => setRange(value ?? createTodayRange())}
								className="w-full"
							/>
						</PopoverContent>
					</Popover>

					<Button
						type="button"
						variant="outline"
						onClick={() => reloadEntries(rangePayload)}
						disabled={pending}
						className="h-10 w-full sm:h-8 sm:w-auto">
						{pending ? (
							<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
						) : (
							<RefreshCcwIcon data-icon="inline-start" />
						)}
						Применить
					</Button>

					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							const todayRange = createTodayRange();
							setSortKey("changedAt");
							setSortDirection("desc");
							setRange(todayRange);
							void reloadEntries({
								from: dateToIso(todayRange.from),
								to: dateToIso(todayRange.to),
							});
						}}
						disabled={pending}
						className="h-10 w-full sm:h-8 sm:w-auto">
						Сбросить
					</Button>

					<Button
						type="button"
						onClick={handleExport}
						disabled={exporting}
						className="h-10 w-full sm:h-8 sm:w-auto">
						{exporting ? (
							<LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
						) : (
							<DownloadIcon data-icon="inline-start" />
						)}
						Выгрузить DOCX
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader className="hidden sm:table-header-group">
						<TableRow>
							{sortableColumns.map((column) => {
								const active = sortKey === column.key;
								const Icon = column.icon;

								return (
									<TableHead key={column.key}>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => handleSort(column.key)}
											className={cn(
												"-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground",
												active && "text-foreground"
											)}>
											<Icon />
											{column.label}
											<SortIcon active={active} direction={sortDirection} />
										</Button>
									</TableHead>
								);
							})}
						</TableRow>
					</TableHeader>
					<TableBody className="block space-y-3 sm:table-row-group sm:space-y-0">
						{sortedEntries.length > 0 ? (
							sortedEntries.map((entry) => (
								<TableRow
									key={entry.id}
									className="block rounded-xl border sm:table-row sm:rounded-none sm:border-x-0">
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Изменено">
										<span className="text-right sm:text-left">{formatTimestamp(entry.changedAt)}</span>
									</TableCell>
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Дата действия">
										<span className="text-right sm:text-left">{entry.effectiveDate}</span>
									</TableCell>
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Пользователь">
										<span className="text-right sm:text-left">{entry.userLogin}</span>
									</TableCell>
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 font-medium before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Помещение">
										{entry.roomName}
									</TableCell>
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Было">
										<span className="text-right sm:text-left">{entry.oldProgress}%</span>
									</TableCell>
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Стало">
										<span className="text-right sm:text-left">{entry.newProgress}%</span>
									</TableCell>
									<TableCell
										className="flex items-start justify-between gap-4 whitespace-normal px-3 py-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] sm:table-cell sm:p-2 sm:before:hidden"
										data-label="Тип">
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
									className="block h-auto px-4 py-8 text-center text-muted-foreground sm:table-cell sm:h-32">
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
