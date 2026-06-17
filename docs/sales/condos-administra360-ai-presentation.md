# CONDOS para Administra 360

## Operación conectada con IA para edificios y administradoras

CONDOS conecta residentes, garita, administración, proveedores, finanzas y directiva en un solo flujo privado.

El objetivo no es "otra app". Es reducir llamadas, WhatsApps, confusión en garita, reclamos de mantenimiento y dudas sobre el dinero.

## Lo que la IA hace diferente

La IA no vive aislada en un chat. Lee la memoria del edificio:

- tickets anteriores
- proveedores guardados
- historial de costos
- documentos y recibos
- propuestas y decisiones
- work orders y evidencias
- reservas, visitantes y eventos operativos

Con eso puede:

- entender el problema
- buscar casos similares
- recomendar el proveedor correcto
- preparar el mensaje para el electricista, plomero, técnico de ascensor u otro contacto
- crear un plan de acción con evidencia
- dejar todo trazado para administración y directiva

Cuando las integraciones están configuradas, CONDOS puede despachar el contacto al proveedor guardado bajo reglas de seguridad. Si falta evidencia o el caso no es claro, pide aprobación del admin.

## Flujo ejemplo: daño de agua

1. Residente reporta filtración con foto.
2. IA revisa tickets similares, unidad, historial y proveedores.
3. Detecta si conviene plomero, mantenimiento interno o emergencia.
4. Prepara mensaje al proveedor con contexto y prioridad.
5. Admin confirma o se activa despacho seguro si cumple las reglas.
6. Proveedor responde, se crea seguimiento, cotización y evidencia.
7. Residentes ven avance; directiva ve costo, recibo y decisión.

## Garita y visitantes

El guardia no decide solo. El guardia verifica:

- visitas preaprobadas
- delivery o paquete esperado
- invitados de fiesta
- visitantes recurrentes
- número del residente para llamar si la app no responde

Si alguien llega sin estar aprobado, guardia notifica al residente desde CONDOS. Si no responde, usa los teléfonos guardados.

## Reservas de áreas comunes

La administración define:

- amenity: gimnasio, piscina, cancha, salón, BBQ, coworking
- horarios disponibles
- duración del slot
- cupo máximo
- reglas de aprobación

El residente reserva desde la app. CONDOS bloquea sobrecupos y doble reserva. Las reservas de cada semana se abren el domingo al mediodía para la semana siguiente.

## Finanzas y transparencia

CONDOS muestra:

- alícuotas y cuentas por cobrar
- comprobantes de pago
- revisión y aprobación del admin
- gastos por categoría
- recibos adjuntos
- presupuesto vs gasto real
- explicación simple de cada gasto
- reporte mensual para directiva

## Por qué importa para una administradora

CONDOS crea una memoria operacional por edificio. La administradora deja de depender de chats sueltos y conversaciones perdidas.

Lo que antes estaba repartido entre WhatsApp, llamadas, hojas de cálculo y memoria del guardia queda conectado, buscable y auditable.

## Demo privada de 15 minutos

1. Residente crea visita y reserva un amenity.
2. Guardia ve visitantes, fiesta, paquete y delivery.
3. Residente reporta problema.
4. IA recomienda proveedor y prepara contacto.
5. Admin revisa work order, cotización y gasto.
6. Directiva ve transparencia y reporte mensual.

## Estado verificado

Antes de actualizar esta presentación corrimos auditoría completa:

- backend tests: 133/133
- build de producción: ok
- evaluación AI: 20/20
- E2E local de piloto: 90/90
- auditoría local AI/ops/i18n: 34/34 ejecutadas
- smoke producción: ok
- producción segura: ok
- hardening producción: ok
- backup/restore dry run: ok

## Nota honesta

La app funciona sin WhatsApp ni proveedor de IA configurado, pero el contacto real automático a proveedores requiere credenciales de integración. CONDOS degrada de forma segura: si no puede despachar, deja el plan, el mensaje y la evidencia listos para que el admin confirme.

