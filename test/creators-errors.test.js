import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCreatorsError,
  uploadWaitMs,
} from "../src/adapters/creators-session.js";

test("erro de sessão é reconhecido — é o que interrompe o lote", () => {
  // Com cookie expirado, cada episódio restante queimaria 60s pra falhar igual.
  for (const msg of [
    "Timeout esperando UI do Creators (New episode). Cookies podem ter expirado.",
    "navegou para accounts.spotify.com/login",
    "Sessão inválida",
  ]) {
    assert.equal(classifyCreatorsError(new Error(msg)), "session", msg);
  }
});

test("crash do navegador é separado de falha de sessão", () => {
  for (const msg of [
    "Target page, context or browser has been closed",
    "Execution context was destroyed",
    "page crash detected",
  ]) {
    assert.equal(classifyCreatorsError(new Error(msg)), "crash", msg);
  }
});

test("erro de rede", () => {
  for (const msg of [
    "net::ERR_CONNECTION_RESET",
    "socket hang up",
    "Navigation timeout of 30000 ms exceeded",
  ]) {
    assert.equal(classifyCreatorsError(new Error(msg)), "network", msg);
  }
});

test("mudança de UI do Creators", () => {
  for (const msg of [
    "Não achei o botão New Episode — UI pode ter mudado.",
    'Botão "Save draft" não apareceu após fechar o editor.',
    "Campo Description obrigatório não encontrado.",
  ]) {
    assert.equal(classifyCreatorsError(new Error(msg)), "ui", msg);
  }
});

test("o que não casa vira 'unknown', não 'session'", () => {
  // Importante: só 'session' para o lote inteiro, então o default tem que ser conservador.
  assert.equal(classifyCreatorsError(new Error("algo estranho")), "unknown");
  assert.equal(classifyCreatorsError(null), "unknown");
  assert.equal(classifyCreatorsError(undefined), "unknown");
  assert.equal(classifyCreatorsError(new Error("")), "unknown");
});

test("aceita string crua além de Error", () => {
  assert.equal(classifyCreatorsError("Cookies podem ter expirado"), "session");
});

test("uploadWaitMs escala com o tamanho do arquivo", () => {
  // Um clipe pequeno mantém o piso de 6 min.
  assert.equal(uploadWaitMs(0), 6 * 60_000);
  assert.equal(uploadWaitMs(50), 6 * 60_000 + 30_000);

  // 2 GB (o que "melhor qualidade" produz num vídeo longo) precisa de bem mais
  // que o teto fixo de 6 min que existia antes.
  assert.ok(uploadWaitMs(2230) > 20 * 60_000, "2.2 GB ganha mais de 20 min");

  // Mas nunca sem limite — um upload travado não pode prender o lote.
  assert.equal(uploadWaitMs(100_000), 45 * 60_000);
});

test("uploadWaitMs não quebra com entrada inválida", () => {
  for (const bad of [null, undefined, NaN, -5, "abc"]) {
    assert.equal(uploadWaitMs(bad), 6 * 60_000);
  }
});
