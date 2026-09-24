import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },  // sobe gradualmente até 20 "usuários" simulados
    { duration: '20s', target: 20 },  // mantém 20 usuários batendo na API por 20s
    { duration: '10s', target: 0 },   // desce até 0 no final
  ],
};

export default function () {
  const res = http.get('http://localhost:3000/battle?pokemonA=pikachu&pokemonB=charmander');
  check(res, {
    'status é 200': (r) => r.status === 200,
  });
  sleep(0.1);
}