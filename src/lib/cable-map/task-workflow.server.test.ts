import { describe, expect, it } from "vitest";
import * as Xlsx from "xlsx";

import type { AuthSession } from "@/lib/auth/shared";
import { splitKanbanTaskSchema } from "@/lib/cable-map/shared";

import {
	createImportableTaskMatches,
	getAllowedImportStages,
	parseTaskCableRows,
} from "./task-workflow.server";

function session(department: AuthSession["department"], role: AuthSession["role"] = "user"): AuthSession {
	return { id: "00000000-0000-4000-8000-000000000001", login: "tester", role, department };
}

function createWorkbookBuffer(sheets: Array<{ name: string; rows: string[][] }>) {
	const workbook = Xlsx.utils.book_new();

	for (const sheet of sheets) {
		Xlsx.utils.book_append_sheet(workbook, Xlsx.utils.aoa_to_sheet(sheet.rows), sheet.name);
	}

	return Buffer.from(Xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

describe("Kanban import permissions", () => {
	it("allows MASTER to select any of the five stages", () => {
		expect(getAllowedImportStages(session("tai", "super-admin"))).toEqual([
			"formed",
			"in_progress",
			"curator_review",
			"adjustment",
			"done",
		]);
	});

	it("limits TAI and commissioning to their configured stages", () => {
		expect(getAllowedImportStages(session("tai"))).toEqual(["formed", "curator_review"]);
		expect(getAllowedImportStages(session("commissioning"))).toEqual(["adjustment"]);
		expect(getAllowedImportStages(session("skm"))).toEqual([]);
	});

	it("requires at least one rejected position for a partial acceptance", () => {
		expect(() =>
			splitKanbanTaskSchema.parse({
				listId: "00000000-0000-4000-8000-000000000001",
				rejectedCableIds: [],
			})
		).toThrow();
		expect(
			splitKanbanTaskSchema.parse({
				listId: "00000000-0000-4000-8000-000000000001",
				rejectedCableIds: ["00000000-0000-4000-8000-000000000002"],
			})
		).toMatchObject({ rejectedCableIds: ["00000000-0000-4000-8000-000000000002"] });
	});

	it("keeps only one importable row per matched cable", () => {
		const result = createImportableTaskMatches([
			{
				cableId: "cable-1",
				parsed: {
					rowIndex: 2,
					cableLabel: "A",
					cableJournal: "",
					cableNumber: "",
					fromRoom: "",
					toRoom: "",
					progress: null,
				},
			},
			{
				cableId: "cable-1",
				parsed: {
					rowIndex: 3,
					cableLabel: "A duplicate",
					cableJournal: "",
					cableNumber: "",
					fromRoom: "",
					toRoom: "",
					progress: 50,
				},
			},
			{
				cableId: "cable-2",
				parsed: {
					rowIndex: 4,
					cableLabel: "B",
					cableJournal: "",
					cableNumber: "",
					fromRoom: "",
					toRoom: "",
					progress: null,
				},
			},
		]);

		expect(result.duplicateCount).toBe(1);
		expect(result.matches.map((match) => match.cableId)).toEqual(["cable-1", "cable-2"]);
		expect(result.matches[0].parsed.rowIndex).toBe(2);
	});

	it("parses task cables from a structured sheet after a title sheet", () => {
		const rows = parseTaskCableRows(
			"priority-cables.xlsx",
			createWorkbookBuffer([
				{
					name: "Титульник",
					rows: [["Перечень первоочередных кабелей на прокладку"], ["Ответственный"]],
				},
				{
					name: "цтаи",
					rows: [
						[
							"Цех",
							"№ кабельного журнала",
							"№ блока",
							"Этап",
							"№ договора",
							"Название проекта",
							"изм",
							"№ нитки",
							"Маркировка кабеля",
							"Марка кабеля проектная",
							"Сечение проектное",
							"Класс безопасности",
							"Откуда KKS помещение",
							"Откуда оборудование1",
							"Откуда KKS оборудования",
							"Куда KKS оборудования",
							"Куда оборудование",
							"Куда KKS помещение",
						],
						[
							"ЦТАИ",
							"А-218536",
							"1",
							"ПСЭ-1",
							"03/143",
							"Проект",
							"",
							"1.0307",
							"1HV116k1301",
							"КППГЭнг(A)-FRHF",
							"27х1",
							"2",
							"АЭ408/1",
							"Шкаф сигнализации РЩУ",
							"1HV116",
							"1HR01",
							"Панель РЩУ",
							"АЭ052",
						],
					],
				},
			])
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			cableJournal: "А-218536",
			cableNumber: "1.0307",
			cableLabel: "1HV116k1301",
			fromRoom: "АЭ408/1",
			toRoom: "АЭ052",
		});
	});

	it("parses the PR-27 priority cable workbook shape across task sheets", () => {
		const rows = parseTaskCableRows(
			"Первочередные_кабеля.xlsx",
			createWorkbookBuffer([
				{
					name: "Титульник",
					rows: [["Перечень первоочередных кабелей на прокладку"], ["Ответственный"]],
				},
				{
					name: "цтаи",
					rows: [
						[
							"Цех",
							"№ кабельного журнала",
							"№ блока",
							"Этап",
							"№ договора",
							"Название проекта",
							"изм",
							"№ нитки",
							"Маркировка кабеля",
							"Марка кабеля проектная",
							"Сечение проектное",
							"Класс безопасности",
							"Откуда KKS помещение",
							"Откуда оборудование1",
							"Откуда KKS оборудования",
							"Куда KKS оборудования",
							"Куда оборудование",
							"Куда KKS помещение",
						],
						[
							"ЦТАИ",
							"A-162474",
							"1",
							"ПСЭ-1",
							"03/143",
							"Проект",
							"",
							"1.0374",
							"11HU01k901",
							"КПЭТИнг(В)-FRHF-LOCA",
							"2х2х0,35",
							"2",
							"AЭ 725/1",
							"Сетевая коробка",
							"11HU03",
							"1HY20",
							"Панель",
							"АЭ 341",
						],
					],
				},
				{
					name: "эц",
					rows: [
						[
							"приоритет",
							"Наименование",
							"Кабельный журнал",
							"ГЗ/ЧЗ",
							"ЦЕХ",
							"Полное наименование",
							"Номер кабеля",
							"Монтажная марка",
							"Тип кабеля спр",
							"Сечение кабеля спр",
							"Потребитель",
							"ККСпотребителя",
							"Откуда",
							"Откуда помещение",
							"0",
							"Куда",
							"Куда помещение",
						],
						[
							"ПНР",
							"ПСЭ-1",
							"А-218495",
							"ЧЗ",
							"ЭЦ",
							"Журнал",
							"1.0001",
							"1BV13-200",
							"КВВГЭнг(А)-FRLS",
							"4х1,5",
							"",
							"",
							"Cekция KPУ-6 kB 1BV шkaф 13",
							"АЭ607/1",
							"ЗСД",
							"Cekция KPУ-6 kB 1BV шkaф 1",
							"АЭ607/1",
						],
					],
				},
				{
					name: "Кабеля для ступенчатого пуска н",
					rows: [
						["АРМАТУРА"],
						[
							"№ п/п",
							"KKS",
							"Наименование механизма",
							"Филиал",
							"Место установки",
							"Система",
							"Условное обозначение",
							"№ листа полной схемы",
							"Место питания",
							"Марка шкафа УКТСс БУЗ/БУК",
							"Марка шкафа УКТС связи БЩУ и РЩУ",
							"Марка кроссового шкафа",
							"Шлейф силовой",
							"Шлейф контрольный",
							"Кабель",
							"Кабель",
						],
						[
							"279",
							"1TQ12S02",
							"Задвижка",
							"СМАТЭ",
							"ГА306/1",
							"УСБТ-1",
							"",
							"",
							"",
							"",
							"",
							"",
							"",
							"",
							"1TQ12S02K334A",
							"1TQ12S02K334",
						],
					],
				},
			])
		);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			cableJournal: "A-162474",
			cableNumber: "1.0374",
			cableLabel: "11HU01k901",
			fromRoom: "AЭ 725/1",
			toRoom: "АЭ 341",
		});
		expect(rows[1]).toMatchObject({
			cableJournal: "А-218495",
			cableNumber: "1.0001",
			cableLabel: "1BV13-200",
			fromRoom: "АЭ607/1",
			toRoom: "АЭ607/1",
		});
	});
});
