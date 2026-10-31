import * as THREE from 'three';
import * as SunCalc from 'suncalc';

const OFFSET_SAO_PAULO_H = -3;

/** `dataISO` = 'AAAA-MM-DD'; `hora` decimal local (15.5 = 15:30). */
export function horaSaoPauloParaUtc(dataISO: string, hora: number): Date {
  const [ano, mes, dia] = dataISO.split('-').map(Number) as [number, number, number];
  const minutos = Math.round((hora - OFFSET_SAO_PAULO_H) * 60);
  return new Date(Date.UTC(ano, mes - 1, dia, 0, minutos));
}

/** Direção unitária do chão para o sol, eixos x=leste, y=cima, z=sul. */
export function sunDirection(data: Date, lat: number, lon: number): THREE.Vector3 {
  const { azimuth, altitude } = SunCalc.getPosition(data, lat, lon);
  const az = THREE.MathUtils.degToRad(azimuth);
  const alt = THREE.MathUtils.degToRad(altitude);
  return new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
}
