"""
TCP Proxy — Capture ZKTeco ADMS protocol between device and Mita Pro
====================================================================

Sits between the attendance device and Mita Pro to capture EXACT bytes
exchanged. No more guessing!

SETUP:
  1. Keep Mita Pro running on port 7005 (ADMS mode) on your PC
  2. Run this proxy on port 7006:
       python tcp_proxy.py --listen-port 7006 --target-port 7005
  3. Change attendance device to connect to your PC IP on port 7006:
       IP server: 192.168.001.046
       Port:      7006
  4. Wait for device to connect — all bytes will be logged
  5. Copy the output and share it for analysis

  After done, change device back to VPS (123.30.48.72 port 7005).
"""
import asyncio
import argparse
import sys
from datetime import datetime


class ProxyLogger:
    def __init__(self, log_path):
        self.log_path = log_path
        self.f = open(log_path, 'a', encoding='utf-8') if log_path else None
        self.conn_count = 0

    def log(self, msg):
        print(msg)
        if self.f:
            self.f.write(msg + '\n')
            self.f.flush()

    def log_data(self, direction, data):
        ts = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        hex_str = data.hex()
        # Also show byte-by-byte with spaces for readability
        hex_spaced = ' '.join(f'{b:02x}' for b in data)
        line = f"[{ts}] {direction} ({len(data)}B): {hex_str}"
        detail = f"         bytes: {hex_spaced}"
        self.log(line)
        self.log(detail)

    def close(self):
        if self.f:
            self.f.close()


async def relay(direction, reader, writer, logger):
    """Relay data from reader to writer, logging all bytes."""
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                logger.log(f"  [{direction}] EOF — connection closed by sender")
                break
            logger.log_data(direction, data)
            writer.write(data)
            await writer.drain()
    except ConnectionResetError:
        logger.log(f"  [{direction}] Connection reset")
    except Exception as e:
        logger.log(f"  [{direction}] Error: {e}")
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def handle_client(client_reader, client_writer, target_host, target_port, logger):
    """Handle one device connection: connect to Mita Pro and relay."""
    addr = client_writer.get_extra_info('peername')
    logger.conn_count += 1
    n = logger.conn_count
    logger.log(f"\n{'='*70}")
    logger.log(f"CONNECTION #{n} from {addr[0]}:{addr[1]}")
    logger.log(f"{'='*70}")

    try:
        target_reader, target_writer = await asyncio.open_connection(
            target_host, target_port
        )
        logger.log(f"  Connected to Mita Pro at {target_host}:{target_port}")
    except Exception as e:
        logger.log(f"  FAILED to connect to Mita Pro: {e}")
        client_writer.close()
        return

    # Relay both directions simultaneously
    task_d2s = asyncio.create_task(
        relay("DEVICE→MITA", client_reader, target_writer, logger)
    )
    task_s2d = asyncio.create_task(
        relay("MITA→DEVICE", target_reader, client_writer, logger)
    )

    done, pending = await asyncio.wait(
        [task_d2s, task_s2d],
        return_when=asyncio.FIRST_COMPLETED,
    )

    # Cancel the other direction when one side closes
    for t in pending:
        t.cancel()
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass

    logger.log(f"CONNECTION #{n} ENDED")
    logger.log(f"{'='*70}\n")


async def main():
    parser = argparse.ArgumentParser(
        description='TCP Proxy for capturing ZKTeco ADMS protocol'
    )
    parser.add_argument(
        '--listen-port', type=int, default=7006,
        help='Port to listen on (default: 7006)'
    )
    parser.add_argument(
        '--listen-host', default='0.0.0.0',
        help='Host to listen on (default: 0.0.0.0)'
    )
    parser.add_argument(
        '--target-host', default='127.0.0.1',
        help='Mita Pro host (default: 127.0.0.1)'
    )
    parser.add_argument(
        '--target-port', type=int, default=7005,
        help='Mita Pro port (default: 7005)'
    )
    parser.add_argument(
        '--log-file', default='proxy_capture.log',
        help='Log file path (default: proxy_capture.log)'
    )
    args = parser.parse_args()

    logger = ProxyLogger(args.log_file)
    logger.log(f"\n{'#'*70}")
    logger.log(f"# TCP Proxy started at {datetime.now()}")
    logger.log(f"# Listen: {args.listen_host}:{args.listen_port}")
    logger.log(f"# Target: {args.target_host}:{args.target_port}")
    logger.log(f"# Log:    {args.log_file}")
    logger.log(f"{'#'*70}")
    logger.log(f"Waiting for device to connect on port {args.listen_port}...")
    logger.log(f"(Device should be configured to this PC's IP + port {args.listen_port})")

    server = await asyncio.start_server(
        lambda r, w: handle_client(r, w, args.target_host, args.target_port, logger),
        args.listen_host, args.listen_port,
    )

    try:
        async with server:
            await server.serve_forever()
    except KeyboardInterrupt:
        logger.log("\nProxy stopped by user (Ctrl+C)")
    finally:
        logger.close()


if __name__ == '__main__':
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
