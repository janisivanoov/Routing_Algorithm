import fs from "fs";
import BN from "bn.js";

type RawPair = {
  reserve0: string;
  reserve1: string;
  fee?: string;
  token0?: string;
  token1?: string;
};

type Pair = {
  address: string;
  reserve0: BN;
  reserve1: BN;
  fee?: BN;
  token0?: string;
  token1?: string;
};

let pairs = new Map<string, Pair>();

let cnt = fs.readFileSync("../../_pairs.json", { encoding: "utf-8" });
let _pairs: { [a: string]: Pair } = JSON.parse(cnt);

Object.entries(_pairs).forEach(([address, _pair]) => {
  let pair: Pair = {
    address,
    reserve0: new BN(_pair.reserve0),
    reserve1: new BN(_pair.reserve1),
  };
  if (_pair.fee) pair.fee = new BN(_pair.fee);
  if (_pair.token0) {
    pair.token0 = _pair.token0;
    pair.token1 = _pair.token1;
  }
  pairs.set(address, pair);
});

function pairKey(tokenA: string, tokenB: string): string {
  return tokenA < tokenB ? tokenA + "," + tokenB : tokenB + "," + tokenA;
}

let pairMap = new Map<string, Pair[]>();
pairs.forEach((pair) => {
  if (!pair.token0 || !pair.token1) return;
  let key = pairKey(pair.token0, pair.token1);
  let _pairs = pairMap.get(key);
  if (!_pairs) {
    _pairs = [];
    pairMap.set(key, _pairs);
  }
  _pairs.push(pair);
});


// let m: [string, number][] = [];
// pairMap.forEach((pairs, key) => {
//   m.push([key, pairs.length]);
// });
// m.sort((a, b) => b[1] - a[1]);
// m.forEach((t) => console.log(t.join("=>")));

// get number of tokens, connected to token

let t = new Map<string, Set<string>>();
pairs.forEach((pair) => {
  if (!pair.token0 || !pair.token1) return;
  if (!t.has(pair.token0)) t.set(pair.token0, new Set());
  t.get(pair.token0)!.add(pair.token1);
  if (!t.has(pair.token1)) t.set(pair.token1, new Set());
  t.get(pair.token1)!.add(pair.token0);
});

let c = 0;
t.forEach((v) => (c += +(v.size > 1)));
console.log(t);
console.log(c);

function getPairs(tokenA: string, tokenB: string): Pair[] {
  return pairMap.get(pairKey(tokenA, tokenB)  );
}


// 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
// 0x55d398326f99059fF775485246999027B3197955

function isqrt(s: BN): BN {
  let x0 = s.divn(2);
  if (x0.eqn(0)) return new BN(0);
  let x1 = x0.add(s.div(x0)).divn(2);
  while (x1.lt(x0)) {
    x0 = x1;
    x1 = x0.add(s.div(x0)).divn(2);
  }
  return x0;
}

function th(a1: BN, b1: BN, a2: BN, b2: BN): BN {
  return isqrt(a1.mul(a2).mul(b1).div(b2)).sub(a1);
}

function getAmountOut(amountIn: BN, reserveIn: BN, reserveOut: BN): BN {
  return reserveOut.mul(amountIn).div(reserveIn.add(amountIn));
}

function getAmountOutPair(amountIn: BN, tokenIn: string, pair: Pair) {
  let { reserve0, reserve1 } = pair;
  if (pair.token0 !== tokenIn) {
    [reserve0, reserve1] = [reserve1, reserve0];
  }
  return getAmountOut(amountIn, reserve0, reserve1);
}


// function that, given input and output tokens, returns pairs, parts and output amount
function f(amountIn: BN, fromToken: string, toToken: string) {
  // how to sort?
  let pairs = getPairs(fromToken, toToken);
  let rev = pairs[0].token0 !== fromToken;
  pairs.sort((a, b) =>
    getAmountOutPair(amountIn, fromToken, b).cmp(
      getAmountOutPair(amountIn, fromToken, a)
    )
  );
  let { reserve0: a1, reserve1: b1 } = pairs[0];
  if (rev) {
    [a1, b1] = [b1, a1];
  }
  let res: { pair: Pair; part: number }[] = [];
  for (let i = 1; i < pairs.length; i++) {
    let { reserve0: a2, reserve1: b2 } = pairs[i];
    if (rev) {
      [a2, b2] = [b2, a2];
    }
    let x = th(a1, b1, a2, b2);
    if (x.lt(amountIn)) {
      res.push({
        pair: pairs[i - 1],
        // part is stored as percents
        part: x.muln(100).div(amountIn).toNumber(),
      });
      a1 = a1.add(a2);
      b1 = b1.add(b2);
    }
  }
  return {
    amountOut: getAmountOut(amountIn, a1, b1),
    res,
  };
}


let routeMap = new Map<string, Map<string, Pair[]>>();

type Segment = { parts: { pair: Pair; part: number }[]; outAmount: BN };
type Route = { segments: Segment[]; outAmount: BN };

function getSegment(inAmount: BN, pairs: Pair[]): Segment {
  throw Error("not implemented");
}

async function getRoute(
  inAmount: BN,
  inToken: string,
  outToken: string
): Promise<Route | null> {
  // after filled, go from outToken to inToken and accumulate path
  // we can also accumulate gas here
  let m = new Map<string, { fromToken: string; seg: Segment }>();
  let p = [inToken];
  // cpu-intense part, here we can controll if new message arrived (recompute route)
  while (p.length > 0) {
    let token = p.pop();
    // if token is not in m, but in p, it's inToken
    let amount = m.get(token)?.seg.outAmount ?? inAmount;
    routeMap.get(token).forEach((pairs, nextToken) => {
      let seg = getSegment(amount, pairs);
      let t = m.get(nextToken);
      // to add gas here, check that newGas-prevGas<=toGas(newOut-prevOut)
      if (!t || seg.outAmount.gt(t.seg.outAmount)) {
        m.set(nextToken, { fromToken: inToken, seg: seg });
        if (nextToken !== outToken) {
          p.unshift(nextToken);
        }
      }
    });
  }
  let { fromToken, seg } = m.get(outToken)!;
  let outAmount = seg.outAmount;
  let segments = [];
  do {
    segments.push(seg);
    ({ fromToken, seg } = m.get(fromToken)!);
  } while (fromToken !== inToken);
  return { segments, outAmount };
}
