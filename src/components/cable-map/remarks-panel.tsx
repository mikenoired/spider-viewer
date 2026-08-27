"use client";

import { useRouter } from "@tanstack/react-router";
import { CheckIcon, LoaderCircleIcon, MessageSquarePlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createRemark, updateRemarkStatus } from "@/lib/cable-map/functions";
import type { RemarkTargetType, RemarksData } from "@/lib/cable-map/shared";

const targetLabels: Record<RemarkTargetType, string> = {
	cable_change: "Последнее изменение кабеля",
	room_change: "Выполненные работы по помещению",
	priority_list: "Список или его статус",
};

export function RemarksPanel({ data, canManage }: { data: RemarksData; canManage: boolean }) {
	const router = useRouter();
	const [targetType, setTargetType] = useState<RemarkTargetType>("cable_change");
	const [targetId, setTargetId] = useState("");
	const [content, setContent] = useState("");
	const [pending, setPending] = useState(false);
	const [updatingId, setUpdatingId] = useState<string | null>(null);
	const targets = useMemo(
		() => data.targets.filter((target) => target.type === targetType),
		[data.targets, targetType]
	);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!targetId || !content.trim()) return;
		setPending(true);
		try {
			await createRemark({ data: { targetType, targetId, content } });
			setContent("");
			setTargetId("");
			await router.invalidate();
			toast.success("Замечание зарегистрировано.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось создать замечание.");
		} finally {
			setPending(false);
		}
	}

	async function resolve(remarkId: string, status: "open" | "resolved") {
		setUpdatingId(remarkId);
		try {
			await updateRemarkStatus({ data: { remarkId, status } });
			await router.invalidate();
			toast.success(status === "resolved" ? "Замечание отмечено решённым." : "Замечание снова открыто.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Не удалось обновить замечание.");
		} finally {
			setUpdatingId(null);
		}
	}

	return (
		<div className="grid gap-4 px-4 pb-4 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<MessageSquarePlusIcon className="size-4" />
						Новое замечание
					</CardTitle>
					<CardDescription>
						Создайте заявку по последнему изменению файла, выполненной работе или списку на канбан-доске.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="grid gap-4" onSubmit={submit}>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="remark-type">К чему относится</FieldLabel>
								<select
									id="remark-type"
									className="h-9 w-full rounded-md border bg-background px-3 text-sm"
									value={targetType}
									onChange={(event) => {
										setTargetType(event.target.value as RemarkTargetType);
										setTargetId("");
									}}>
									{Object.entries(targetLabels).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</Field>
							<Field>
								<FieldLabel htmlFor="remark-target">Конкретная запись</FieldLabel>
								<select
									id="remark-target"
									className="h-9 w-full rounded-md border bg-background px-3 text-sm"
									value={targetId}
									onChange={(event) => setTargetId(event.target.value)}>
									<option value="">Выберите запись</option>
									{targets.map((target) => (
										<option key={target.id} value={target.id}>
											{target.label} — {target.details}
										</option>
									))}
								</select>
							</Field>
							<Field>
								<FieldLabel htmlFor="remark-content">Текст замечания</FieldLabel>
								<textarea
									id="remark-content"
									className="min-h-28 w-full rounded-md border bg-background p-3 text-sm"
									value={content}
									onChange={(event) => setContent(event.target.value)}
									placeholder="Что требуется исправить или проверить?"
									maxLength={4000}
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={pending || !targetId || content.trim().length < 3}>
							{pending ? <LoaderCircleIcon className="animate-spin" /> : null}Создать заявку
						</Button>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Заявки с замечаниями</CardTitle>
					<CardDescription>
						Открытые замечания остаются в списке до подтверждения супер-администратором.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					{data.remarks.length === 0 ? (
						<div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
							Замечаний пока нет.
						</div>
					) : (
						data.remarks.map((remark) => (
							<div key={remark.id} className="rounded-lg border p-4">
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div>
										<div className="text-sm font-semibold">{remark.targetLabel}</div>
										<div className="mt-1 text-xs text-muted-foreground">
											{targetLabels[remark.targetType]} · {remark.createdByLogin} ·{" "}
											{new Date(remark.createdAt).toLocaleString("ru-RU")}
										</div>
									</div>
									<Badge variant={remark.status === "open" ? "destructive" : "secondary"}>
										{remark.status === "open" ? "Открыто" : "Решено"}
									</Badge>
								</div>
								<p className="mt-3 whitespace-pre-wrap text-sm">{remark.content}</p>
								{canManage ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										className="mt-3"
										disabled={updatingId === remark.id}
										onClick={() => void resolve(remark.id, remark.status === "open" ? "resolved" : "open")}>
										{updatingId === remark.id ? <LoaderCircleIcon className="animate-spin" /> : <CheckIcon />}
										{remark.status === "open" ? "Отметить решённым" : "Открыть снова"}
									</Button>
								) : null}
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}
