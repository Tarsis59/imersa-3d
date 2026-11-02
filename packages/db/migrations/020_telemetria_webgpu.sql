-- WebGPU (Plano 09b-5): quantos aparelhos das clientes já têm. A migração do 3D para o renderizador WebGPU do three
-- é decidida com esse número (null = visita de antes desta medida).
ALTER TABLE telemetria_viewer ADD COLUMN webgpu boolean;
