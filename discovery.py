import logging
import socket
import uuid

from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

SERVICE_TYPE = "_comfy-studio._tcp.local."


def install_discovery(server, args, lan_ips):
    async def advertise(app):
        if getattr(args, "tls_certfile", None):
            yield
            return
        addresses = []
        for listen in args.listen.split(","):
            if listen in ("0.0.0.0", "::"):
                addresses.extend(lan_ips())
            elif listen and not listen.startswith("127.") and listen != "::1":
                addresses.append(listen)
        addresses = sorted(set(ip for ip in addresses if ":" not in ip))
        if not addresses:
            yield
            return
        instance = uuid.uuid4().hex[:12]
        service = ServiceInfo(
            SERVICE_TYPE, f"Comfy Studio {instance}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(ip) for ip in addresses],
            port=args.port, properties={"app": "comfy-studio", "protocol": "1"},
            server=f"comfy-{instance}.local.",
        )
        try:
            zeroconf = AsyncZeroconf(interfaces=addresses, ip_version=IPVersion.V4Only)
        except OSError as error:
            logging.warning("Comfy Studio LAN discovery unavailable: %s", error)
            yield
            return
        registered = False
        try:
            try:
                await zeroconf.async_register_service(service)
                registered = True
                logging.info("Comfy Studio LAN discovery enabled on port %s", args.port)
            except OSError as error:
                logging.warning("Comfy Studio LAN discovery unavailable: %s", error)
            yield
        finally:
            try:
                if registered:
                    await zeroconf.async_unregister_service(service)
            finally:
                await zeroconf.async_close()

    server.app.cleanup_ctx.append(advertise)
