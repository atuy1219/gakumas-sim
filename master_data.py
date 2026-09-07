from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sqlite3


def _varint(buf: bytes, i: int) -> tuple[int,int]:
    v=0; shift=0
    while True:
        b=buf[i]; i+=1
        v |= (b & 0x7f) << shift
        if not (b & 0x80): return v,i
        shift += 7
        if shift > 70: raise ValueError('invalid protobuf varint')


def _signed(v: int) -> int:
    return v-(1<<64) if v >= (1<<63) else v


def parse_protobuf_wire(buf: bytes) -> dict[int, object]:
    i=0; out={}
    while i < len(buf):
        tag,i=_varint(buf,i); field=tag>>3; wire=tag&7
        if wire==0:
            v,i=_varint(buf,i); value=_signed(v)
        elif wire==1:
            value=buf[i:i+8]; i+=8
        elif wire==2:
            n,i=_varint(buf,i); raw=buf[i:i+n]; i+=n
            try: value=raw.decode('utf-8')
            except UnicodeDecodeError: value=raw
        elif wire==5:
            value=buf[i:i+4]; i+=4
        else:
            raise ValueError(f'unsupported protobuf wire type {wire}')
        out[field]=value
    return out


@dataclass(frozen=True)
class AutoEvaluation:
    type: int
    exam_effect_type: int
    remaining_term: int
    evaluation_type: int
    evaluation: int
    exam_status_enchant_coefficient_permil: int

@dataclass(frozen=True)
class CardSelectEvaluation:
    type: int
    exam_effect_type: int
    remaining_term: int
    evaluation_type: int
    evaluation: int

@dataclass(frozen=True)
class GrowEffectEvaluation:
    type: int
    exam_effect_type: int
    remaining_term: int
    grow_effect_type: int
    evaluation: int
    exam_status_enchant_coefficient_permil: int

@dataclass(frozen=True)
class ResourceEvaluation:
    type: int
    resource_type: int
    resource_id: str
    remaining_term: int
    evaluation_type: int
    addition: int
    multiplication: int

@dataclass(frozen=True)
class TriggerEvaluation:
    type: int
    trigger_id: str
    coefficient_permil: int
    count: int

@dataclass(frozen=True)
class PlayCardEvaluation:
    produce_card_id: str
    remaining_term: int
    evaluation: int

@dataclass(frozen=True)
class PlayProduceCardEvaluation:
    type: int
    produce_card_id: str
    remaining_term: int
    evaluation: int


class OfficialMasterIndex:
    def __init__(self) -> None:
        self.auto: dict[tuple[int,int,int],dict[int,AutoEvaluation]]={}
        self.card_select: dict[tuple[int,int,int],dict[int,CardSelectEvaluation]]={}
        self.grow: dict[tuple[int,int,int],dict[int,GrowEffectEvaluation]]={}
        self.resource: dict[tuple[int,int],dict[int,list[ResourceEvaluation]]]={}
        self.trigger: dict[int,dict[str,TriggerEvaluation]]={}
        self.play_card: dict[int,dict[str,PlayCardEvaluation]]={}
        self.play_produce_card: dict[tuple[int,int],dict[str,PlayProduceCardEvaluation]]={}

    @classmethod
    def from_directory(cls, root: str | Path) -> 'OfficialMasterIndex':
        self=cls(); root=Path(root)
        self._load_auto(root/'ProduceExamAutoEvaluation.sqlite')
        self._load_card_select(root/'ProduceExamAutoCardSelectEvaluation.sqlite')
        self._load_grow(root/'ProduceExamAutoGrowEffectEvaluation.sqlite')
        self._load_resource(root/'ProduceExamAutoResourceEvaluation.sqlite')
        self._load_trigger(root/'ProduceExamAutoTriggerEvaluation.sqlite')
        self._load_play_card(root/'ProduceExamAutoPlayCardEvaluation.sqlite')
        self._load_play_produce_card(root/'ProduceExamAutoPlayProduceCardEvaluation.sqlite')
        return self

    def _rows(self,path: Path,table: str):
        con=sqlite3.connect(path)
        try: return con.execute(f'SELECT data FROM "{table}"').fetchall()
        finally: con.close()

    def _load_auto(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoEvaluation'):
            f=parse_protobuf_wire(blob); r=AutoEvaluation(*(int(f.get(i,0)) for i in range(1,7)))
            self.auto.setdefault((r.type,r.exam_effect_type,r.remaining_term),{})[r.evaluation_type]=r

    def _load_card_select(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoCardSelectEvaluation'):
            f=parse_protobuf_wire(blob); r=CardSelectEvaluation(*(int(f.get(i,0)) for i in range(1,6)))
            self.card_select.setdefault((r.type,r.exam_effect_type,r.remaining_term),{})[r.evaluation_type]=r

    def _load_grow(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoGrowEffectEvaluation'):
            f=parse_protobuf_wire(blob); r=GrowEffectEvaluation(*(int(f.get(i,0)) for i in range(1,7)))
            self.grow.setdefault((r.type,r.exam_effect_type,r.remaining_term),{})[r.grow_effect_type]=r

    def _load_resource(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoResourceEvaluation'):
            f=parse_protobuf_wire(blob)
            r=ResourceEvaluation(int(f.get(1,0)),int(f.get(2,0)),str(f.get(3,'')),int(f.get(4,0)),int(f.get(5,0)),int(f.get(6,0)),int(f.get(7,0)))
            self.resource.setdefault((r.type,r.remaining_term),{}).setdefault(r.evaluation_type,[]).append(r)

    def _load_trigger(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoTriggerEvaluation'):
            f=parse_protobuf_wire(blob); r=TriggerEvaluation(int(f.get(1,0)),str(f.get(2,'')),int(f.get(3,0)),int(f.get(4,0)))
            self.trigger.setdefault(r.type,{})[r.trigger_id]=r

    def _load_play_card(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoPlayCardEvaluation'):
            f=parse_protobuf_wire(blob); r=PlayCardEvaluation(str(f.get(1,'')),int(f.get(2,0)),int(f.get(3,0)))
            self.play_card.setdefault(r.remaining_term,{})[r.produce_card_id]=r

    def _load_play_produce_card(self,p):
        for (blob,) in self._rows(p,'ProduceExamAutoPlayProduceCardEvaluation'):
            f=parse_protobuf_wire(blob); r=PlayProduceCardEvaluation(int(f.get(1,0)),str(f.get(2,'')),int(f.get(3,0)),int(f.get(4,0)))
            self.play_produce_card.setdefault((r.type,r.remaining_term),{})[r.produce_card_id]=r
    @staticmethod
    def _fallback(table, key, fallback_key):
        v = table.get(key)
        if v is not None:
            return v
        return table.get(fallback_key, {})

    def get_auto_group(self, type: int, exam_effect_type: int, remaining_term: int):
        return self._fallback(
            self.auto,
            (int(type), int(exam_effect_type), int(remaining_term)),
            (int(type), int(exam_effect_type), -1),
        )

    def get_card_select_group(self, type: int, exam_effect_type: int, remaining_term: int):
        return self._fallback(
            self.card_select,
            (int(type), int(exam_effect_type), int(remaining_term)),
            (int(type), int(exam_effect_type), -1),
        )

    def get_grow_group(self, type: int, exam_effect_type: int, remaining_term: int):
        return self._fallback(
            self.grow,
            (int(type), int(exam_effect_type), int(remaining_term)),
            (int(type), int(exam_effect_type), -1),
        )

    def get_resource_group(self, type: int, remaining_term: int):
        return self._fallback(
            self.resource,
            (int(type), int(remaining_term)),
            (int(type), -1),
        )

    def get_trigger_group(self, type: int):
        return self.trigger.get(int(type), {})

    def get_play_card_group(self, remaining_term: int):
        v = self.play_card.get(int(remaining_term))
        if v is not None:
            return v
        return self.play_card.get(-1, {})

    def get_play_produce_card_group(self, type: int, remaining_term: int):
        return self._fallback(
            self.play_produce_card,
            (int(type), int(remaining_term)),
            (int(type), -1),
        )

