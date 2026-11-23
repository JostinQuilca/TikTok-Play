# TikTok-Play 🖨️🔥

Juego interactivo para **TikTok LIVE** estilo **Impresora de Fotos + Fogata**.

Cuando un espectador envía un regalo en el directo, el sistema captura su nombre y foto de perfil, los coloca en una cola de impresión y anima en pantalla cómo un cabezal de impresora dibuja su foto sobre un rollo de papel continuo que desciende lentamente hasta quemarse en una fogata.

---

## 🚀 Inicio Rápido

### 1. Instalar dependencias
```powershell
pip install -r requirements.txt
```

### 2. Configurar usuario TikTok
Edita `config.json`:
```json
"tiktok_username": "@TU_USUARIO"
```

### 3. Lanzar servidor
```powershell
# Modo simulador (sin TikTok):
.\run.ps1 --mock

# Modo TikTok LIVE real:
.\run.ps1
```

Luego abre `http://localhost:8000` en tu navegador.

---

## 🎮 Teclas de Prueba

| Tecla | Acción |
|---|---|
| `1` | 🌹 Simula regalo Print (Rosa) |
| `2` | 🍩 Simula regalo Big (Dona) |
| `3` | 👑 Simula regalo VIP (Legendary) |
| `4` | 💥 Ráfaga de 5 regalos |
| `H` | HUD de debug |
| `M` | Silenciar/activar audio |

---

## 📺 Usar en TikTok LIVE Studio / OBS

1. Nueva fuente → **Fuente de Navegador**
2. URL: `http://localhost:8000`
3. Dimensiones: **1080 × 1920**

---

## 🎁 Niveles de Regalos

| Nivel | Monedas | Efecto |
|---|---|---|
| 🌹 Print | 1–29 | Foto pequeña (2 por fila) |
| 🍩 Big | 30–99 | Foto grande, fila completa |
| 👑 VIP | 100+ | Gigante, marco dorado, overlay, fanfarria |

---

## 🛠️ Stack Tecnológico

- **Backend:** Python 3.11 · `TikTokLive` · `aiohttp` · `websockets`
- **Frontend:** HTML5 · CSS3 · JavaScript Vanilla · Canvas API · Web Audio API
- **Formato:** 1080×1920 vertical (TikTok LIVE)
