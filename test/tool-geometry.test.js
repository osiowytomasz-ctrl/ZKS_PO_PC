// Geometria narzędzi – te same przypadki co testy Androida (ToolGeometryTest, ToolExportTest, Lathe3DTest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/renderer/js/logic/toolGeometry.js';

const P = (x, y) => ({ x, y });
const shaft = [P(-10, 0), P(10, 0), P(10, 100), P(-10, 100)];
const insertPath = 'M 0 0 L 2 0 L 2 1 L 0 1 Z';
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

test('num, parseContour, bounds', () => {
  near(G.num('12,5'), 12.5); near(G.num(' 8 mm'), 8); near(G.num('brak'), 0); near(G.num(null), 0);
  assert.deepEqual(G.parseContour('0_0;10_20;bad;5_x;-3_4.5'), [P(0, 0), P(10, 20), P(-3, 4.5)]);
  assert.deepEqual(G.parseContour(''), []);
  const b = G.bounds([P(-5, -20), P(5, 50)]); near(b.r, 50); near(b.m, 20); assert.equal(G.bounds([]), null);
});

test('płytki: ×10, |y|, łuki i krzywe', () => {
  assert.deepEqual(G.parseInsertPath('M 1 2 L 3 -4 Z'), [P(10, 20), P(30, 40)]);
  const arc = G.parseInsertPath('M 0 0 A 1 1 0 0 1 2 0');
  assert.equal(arc.length, 19); near(arc[arc.length - 1].x, 20, 1e-4); near(arc[arc.length - 1].y, 0, 1e-4);
  const q = G.parseInsertPath('M 0 0 Q 1 1 2 0'); assert.equal(q.length, 13); near(q[q.length - 1].x, 20);
});

test('zestaw 2D: kolejne narzędzie pod spodem, poziomy odniesienia, płytki', () => {
  const second = [P(-5, -20), P(5, -20), P(5, 50), P(-5, 50)];
  const st = G.buildStack([{ code: 'A', contour: shaft, inserts: [], diameter: 20, length: 10 }, { code: 'B', contour: second, inserts: [], diameter: 10, length: 7 }], false, false);
  const [a, b] = st.layers;
  near(a.outline[0].y, 100); near(a.outline[2].y, 0); near(a.referenceY, 100); near(b.outline[2].y, 100); near(b.referenceY, 170); near(st.bounds.maxY, 170);
  const tool = { code: 'A', contour: shaft, inserts: [insertPath, insertPath], diameter: 10, length: 12, angle: 0, chamfer: false };
  const first = G.buildStack([tool], false, false).layers[0];
  assert.equal(first.inserts.length, 2); assert.deepEqual(first.inserts[0][0], P(-50, -20)); assert.deepEqual(first.inserts[1][0], P(50, -20));
  assert.equal(G.buildStack([tool], true, false).layers[0].inserts.length, 4);
  const faz = { ...tool, inserts: [insertPath], chamfer: true };
  const no = G.buildStack([faz], false, true).layers[0]; near(no.inserts[0][0].x, -50); near(no.inserts[0][0].y, -140);
  const turned = G.buildStack([{ ...faz, angle: 90 }], false, true).layers[0]; assert.notDeepEqual(turned.inserts[0][1], no.inserts[0][1]);
  near(G.buildStack([faz], false, false).layers[0].inserts[0][0].y, -20);
  assert.equal(G.buildStack([], true, false), null);
  assert.equal(G.buildStack([{ code: 'A', contour: [], inserts: [], diameter: 0, length: 0 }], true, false), null);
});

test('miniatura', () => {
  const det = (ins = [], contour = '-10_0;10_0;10_100;-10_100') => ({ columnAY: contour, insertContours: ins.map((c) => ({ code: 'p', contour: c })) });
  const t = { productCode: 'x', columnF: '10', columnJ: '12' };
  assert.equal(G.buildMini(t, null), null); assert.equal(G.buildMini(t, det([], '0_0;1_1')), null); assert.ok(G.buildMini(t, det()));
  const m = G.buildMini({ ...t, columnD: 'fre', columnE: 'wsp' }, det([insertPath, insertPath]));
  assert.ok(m.outline.every((p) => p.x >= 0 && p.x <= G.MINI_W && p.y >= 0 && p.y <= G.MINI_H)); assert.equal(m.inserts.length, 2);
  const base = { ...t, columnD: 'wie', columnE: 'ply' }, two = det([insertPath, insertPath]);
  assert.equal(G.buildMini({ ...base, columnP: 'Iscar' }, two).inserts.length, 1);
  assert.equal(G.buildMini({ ...base, columnP: 'AMEC' }, two).inserts.length, 1);
  assert.equal(G.buildMini({ ...base, columnP: 'Komet' }, two).inserts.length, 4);
  assert.equal(G.buildMini({ ...base, columnP: 'Inna' }, two).inserts.length, 2);
  assert.ok(G.isChamfer({ columnD: 'faz' })); assert.ok(G.isChamfer({ columnE: 'faz' })); assert.ok(!G.isChamfer({ columnD: 'fre' }));
  assert.ok(G.isChamferForPreview('POGF14F', 'wsp', 'frez')); assert.ok(G.isChamferForPreview('x', 'Fazownik', '')); assert.ok(!G.isChamferForPreview('x', 'wsp', 'frez'));
});

test('DXF, obrys, nazwa pliku, współrzędne', () => {
  const tool = (code = 'TR 1', inserts = []) => ({ code, contour: shaft, inserts, diameter: 10, length: 10 });
  const count = (s, sub) => s.split(sub).length - 1;
  assert.equal(G.sanitizeLayer('TR 1.x'), 'TR_1_x'); assert.equal(G.sanitizeLayer('a'.repeat(50)).length, 30);
  assert.equal(G.sanitizeFileName('a/b c:d') + '.dxf', 'a_b_c_d.dxf'); assert.equal(G.sanitizeFileName('x'.repeat(200)).length, 120);
  assert.equal(G.trueColor('#d50000'), 0xd50000); assert.equal(G.trueColor('1f77b4'), 0x1f77b4); assert.equal(G.trueColor('#zz'), 0);
  const dxf = G.buildDxf([tool()]);
  assert.ok(dxf.startsWith('0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n')); assert.ok(dxf.endsWith('0\nENDSEC\n0\nEOF\n'));
  assert.equal(count(dxf, '8\nTR_1\n'), 4); assert.equal(count(dxf, '8\nALL_TOOLS\n'), 4); assert.ok(dxf.includes('8\nOUTER_CONTOUR\n')); assert.ok(dxf.includes('10\n-1.000\n'));
  assert.ok(G.buildDxf([tool('A'), { ...tool('B'), length: 5 }]).includes('20\n-15.000\n'));
  const di = G.buildDxf([tool('TR 1', [{ code: 'pl1', contour: insertPath }])]);
  assert.ok(di.includes('8\nINSERT_TR_1_pl1\n')); assert.equal(count(di, '8\nALL_INSERTS\n'), 4);
  assert.equal(di.split('8\nALL_INSERTS\n420\n')[1].split('\n')[0], String(G.trueColor('#d50000')));
  assert.equal(count(G.buildDxf([{ code: 'X', contour: [], inserts: [], diameter: 0, length: 0 }]), '0\nLINE\n'), 0);
  assert.deepEqual(G.outerContour([P(-10, 0), P(10, 0), P(-5, 50), P(5, 50)]), [P(10, 0), P(5, 50), P(-5, 50), P(-10, 0), P(10, 0)]);
  assert.deepEqual(G.outerContour([P(0, 0)]), []);
  const all = { codes: true, length: true, diameter: true, toolType: true, company: true, date: true, manual: 'Correa op10' };
  assert.equal(G.dxfFileName(all, ['TR1', 'TR2'], 80.5, '10,5', 'wsp', 'Iscar', '2026-11-11'), 'Correa_op10_TR1_TR2_L81_D10.5_wsp_Iscar_2026-11-11.dxf');
  assert.equal(G.dxfFileName({ ...G.defaultNameOptions(), codes: false, length: false }, [], 0, '', '', '', ''), 'Tool_DXF.dxf');
  const txt = G.coordinatesText([{ code: 'TR1', company: 'Iscar', diameter: '10', length: '12', angle: 0, contour: shaft, inserts: [{ code: 'pl1', contour: insertPath }] }]);
  assert.ok(txt.includes('NARZĘDZIE: TR1')); assert.ok(txt.includes('1. X=-10.000  Y=0.000')); assert.ok(txt.includes('--- Płytka: pl1 ---')); assert.ok(txt.includes('1. przed X=-50.000  Y=-20.000'));
});

test('bryła 3D i indeks katalogu', () => {
  assert.equal(G.profileOf([P(0, 0), P(1, 1)]), null);
  assert.deepEqual(G.profileOf(shaft), [P(0, 0), P(10, 0), P(10, 100), P(0, 100)]);
  const mesh = G.buildMesh([shaft], 8);
  assert.equal(mesh.faceCount, 3 * 8); assert.equal(G.buildMesh([[]]), null);
  const pr = G.project(mesh, G.initialCamera(mesh.size), 400, 300); assert.ok(pr.order.length > 0);
  const idx = G.toolIndex({ tools: [{ productCode: 'TR 1', columnF: '10', columnJ: '12' }, { productCode: 'PL1', partStatusColor: '#ff0000', status: 2, stock: 5, available: 1.5 }],
    detailsMap: { 'tr 1': { partsCutting: ['PL1'], partsAccessories: ['X9'], columnAY: '-10_0;10_0;10_100' , insertContours: [] } } });
  assert.ok(idx.tool('tr  1') === null || idx.tool('tr 1'));
  assert.deepEqual(idx.partRows(['TR 1']).map((r) => [r.partCode, r.status, r.available, r.color]), [['PL1', '2', '1.5', '#ff0000'], ['X9', G.NO_DATA, G.NO_DATA, '#ffffff']]);
  assert.ok(idx.hasPartWarning('TR 1')); assert.deepEqual(idx.usages('pl1'), [{ toolCode: 'TR 1', role: 'cutting' }]);
  assert.equal(idx.stackTool('TR 1').contour.length, 3);
});
