# OnlineCall


OnlineCall — лёгкий веб-сервис для аудио конференций. Создавайте встречи в один клик, делитесь ссылкой и общайтесь голосом прямо в браузере без установки приложений и без видеосвязи.
=======
OnlineCall — это лёгкий веб-сервис для аудио конференций. Создавайте встречи в один клик, делитесь ссылкой и общайтесь голосом прямо в браузере без установки приложений и без видеосвязи.


## Возможности

- Создание комнаты с уникальной ссылкой по запросу.
- Подключение по ссылке или коду комнаты, как в Google Meet.
- Встроенный обмен WebRTC для качественной аудио связи без видео.
- Список участников с индикацией включённого/выключенного микрофона.
- Управление микрофоном (включить/выключить) и быстрый выход из встречи.
- Копирование ссылки на встречу одним кликом.


## Требования

- Node.js версии 20 или новее и npm.
- Современный браузер с поддержкой WebRTC (Chrome, Edge, Firefox, Safari).
- Для устойчивой связи через интернет желательно наличие публичных STUN/TURN серверов.

## Локальный запуск

```bash
npm install
cp .env.example .env
npm start
```

По умолчанию сервер поднимется на [http://localhost:3000](http://localhost:3000). Если вы запускаете его на другой машине, обновите `HOST` и `PORT` в `.env`.

## Конфигурация окружения

Создайте файл `.env` (пример — `.env.example`) и укажите необходимые переменные:

| Переменная | Значение по умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `3000` | HTTP-порт приложения. |
| `HOST` | `0.0.0.0` | Интерфейс, на котором слушает сервер. Для локальных тестов можно указать `127.0.0.1`. |
| `TRUST_PROXY` | `1` | Значение, передаваемое в `app.set('trust proxy', …)` для работы за обратным прокси. |
| `CORS_ORIGINS` | (пусто) | Список доменов через запятую, которым разрешены WebSocket-подключения Socket.IO. Оставьте пустым для same-origin. |
| `ICE_SERVERS` | Google STUN | JSON-массив STUN/TURN серверов для WebRTC. Укажите TURN, если нужен ретранслятор. |

Пример значения `ICE_SERVERS` c собственным TURN:

```env
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"user","credential":"secret"}]
```

## Развёртывание на Ubuntu Server 24.04 LTS

### 1. Подготовка системы

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw nginx
```

Включите фаервол и разрешите веб-трафик:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 2. Установка Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 3. Создание пользователя и каталога приложения

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin onlinecall
sudo mkdir -p /opt/onlinecall
sudo chown onlinecall:onlinecall /opt/onlinecall
```

### 4. Клонирование репозитория и установка зависимостей

```bash
# Замените URL на адрес вашего репозитория
sudo -u onlinecall git clone https://github.com/your-account/onlinecall.git /opt/onlinecall
cd /opt/onlinecall
sudo -u onlinecall cp .env.example .env
sudo -u onlinecall nano /opt/onlinecall/.env
sudo -u onlinecall npm install --omit=dev
```

В `.env` пропишите домен, список STUN/TURN серверов и при необходимости ограничьте `CORS_ORIGINS`.

### 5. Сервис systemd

Создайте файл `/etc/systemd/system/onlinecall.service` со следующим содержимым:

```ini
[Unit]
Description=OnlineCall audio conferencing service
After=network.target

[Service]
Type=simple
User=onlinecall
Group=onlinecall
WorkingDirectory=/opt/onlinecall
EnvironmentFile=/opt/onlinecall/.env
ExecStart=/usr/bin/node /opt/onlinecall/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Активируйте сервис:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onlinecall
sudo systemctl status onlinecall
```

Проверьте здоровье приложения:

```bash
curl http://127.0.0.1:3000/healthz
```

### 6. Настройка Nginx и HTTPS

Создайте конфигурацию `/etc/nginx/sites-available/onlinecall`:

```nginx
server {
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Активируйте сайт и перезапустите Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/onlinecall /etc/nginx/sites-enabled/onlinecall
sudo nginx -t
sudo systemctl reload nginx
```

Установите сертификат Let’s Encrypt:

```bash
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

### 7. TURN-сервер (опционально)

Для работы за строгими NAT установите и настройте [coturn](https://github.com/coturn/coturn):

```bash
sudo apt install -y coturn
```

В `/etc/turnserver.conf` включите прослушивание на нужных интерфейсах, задайте `user`, `realm` и `static-auth-secret`, затем добавьте соответствующий `turn:` URL в `ICE_SERVERS`.

Перезапустите службы:

```bash
sudo systemctl restart coturn
sudo systemctl restart onlinecall
```

## Обновление приложения

```bash
cd /opt/onlinecall
sudo -u onlinecall git pull
sudo -u onlinecall npm install --omit=dev
sudo systemctl restart onlinecall
```

После обновлений проверяйте `systemctl status onlinecall` и журналы `journalctl -u onlinecall -f`.

## Использование
=======
## Быстрый старт

```bash
npm install
npm start
```

После запуска сервер будет доступен по адресу [http://localhost:3000](http://localhost:3000).

## Как пользоваться


1. Откройте главную страницу и нажмите «Создать встречу» — вы получите уникальную ссылку.
2. Разрешите доступ к микрофону, чтобы начать говорить.
3. Поделитесь ссылкой с участниками — они смогут присоединиться без регистрации.
4. Управляйте микрофоном кнопкой «Выключить/Включить микрофон» и покидайте комнату кнопкой «Покинуть».


Сервис использует только аудио, поэтому стабильно работает даже при ограниченном канале связи.
=======
Сервис использует только аудио, поэтому работает даже при ограниченном канале связи.

