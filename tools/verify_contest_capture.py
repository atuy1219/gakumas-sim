#!/usr/bin/env python3
"""Verify pinned contest capture ABI/fields against user-supplied v3.4.1 inputs.
No game binary is copied into the output. Requires capstone for disassembly.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN
import extract_gakumas_method_rvas as mapper
from verify_gakumas_v341 import Image, EXPECTED_ELF, EXPECTED_DECODED, BUILD_ID

def verify(elf, b):
    assert hashlib.sha256(elf).hexdigest()==EXPECTED_ELF
    assert hashlib.sha256(b).hexdigest()==EXPECTED_DECODED
    image=Image(elf)
    ranges=[struct.unpack_from('<II',b,8+8*i) for i in range(31)]
    so,sl=ranges[2];to,tl=ranges[19];mo,ml=ranges[5];fo,fl=ranges[11]
    def name(i):
        start=so+i;return b[start:b.index(b'\0',start,so+sl)].decode()
    types=[struct.unpack_from('<16I8H2I',b,to+88*i) for i in range(tl//88)]
    reg,_,typeArray=image.metadata_registration(len(types))
    def typeName(addr):
        kind=(image.word(addr+8)>>16)&255
        if kind in (0x11,0x12):return owner(image.word(addr))
        if kind==0x15:
            gc=image.pointer(addr);definition=typeName(image.pointer(gc));inst=image.pointer(gc+8)
            count=image.word(inst);args=image.pointer(inst+8)
            return definition+'<'+','.join(typeName(image.pointer(args+8*i)) for i in range(count))+'>'
        if kind==0x1d:return typeName(image.pointer(addr))+'[]'
        return {1:'void',2:'bool',8:'int32',9:'uint32',14:'string'}.get(kind,hex(kind))
    def owner(i):
        t=types[i];ns=name(t[1]);n=name(t[0])
        if t[3]!=0xffffffff:return typeName(image.pointer(typeArray+8*t[3]))+'+'+n
        return (ns+'.' if ns else '')+n
    # The names of all consumed fields are recorded; offsets are asserted below.
    selected=[2931,2932,2934,3994,4020,4025,4026,4027,4080,4892,4814,3477]
    fieldArray=image.pointer(reg+88);sizeArray=image.pointer(reg+104)
    fields={};sizes={}
    for i in selected:
        t=types[i];fieldBase=image.pointer(fieldArray+8*i);entry={}
        for j in range(t[18]):
            n,ty,token=struct.unpack_from('<III',b,fo+12*(t[8]+j))
            entry[name(n)]={'offset':image.word(fieldBase+4*j),'type':typeName(image.pointer(typeArray+8*ty))}
        fields[owner(i)]=entry;sizes[owner(i)]=image.word(image.pointer(sizeArray+8*i))
    # Integer + reference positions used by production serializers.
    offsets={2931:[0x10,0x30,0x38],2932:[0x20,0x24,0x28,0x2c,0x30],
        2934:[0x10,0x18,0x20,0x28,0x30,0x38,0x3c,0x40,0x44,0x48],
        3994:[0x10,0x14,0x18,0x78,0x88],4020:[0x10,0x18,0x1c,0x64],
        4025:[0x10,0x18,0x20],4026:[0x10,0x14,0x18,0x1c],
        4027:list(range(0x10,0x38,4))+[0x38,0x40,0x48,0x50,0x58,0x60,0x64,0x68,0x70,0x78],
        4080:[0x10,0x18,0x20,0x28,0x30,0x38,0x40,0x48,0x4c],
        4892:[0x10,0x18,0x24,0x28],4814:[0x10],3477:[0x10]}
    for i,values in offsets.items():
        actual=[f['offset'] for f in fields[owner(i)].values()]
        assert all(v in actual for v in values),(owner(i),values,actual)
    assert sizes[owner(2931)]==144 and sizes[owner(2934)]==80
    rows=[]
    for i,method,token,rva in [(2931,'MoveNext',0x06003A6C,0x07EFCFB0),(2947,'GetSearchResult',0x06003A74,0x07EFE28C)]:
        t=types[i]
        matches=[]
        for mi in range(t[9],t[9]+t[16]):
            m=struct.unpack_from('<7I4H',b,mo+36*mi)
            if name(m[0])==method:matches.append({'type':owner(i),'method':method,'token':hex(m[6]),'args':m[10],'returnType':typeName(image.pointer(typeArray+8*m[2]))})
        assert len(matches)==1 and matches[0]['token']==hex(token)
        mapped=mapper.extract(elf,matches)[0];assert int(mapped['rva'],16)==rva
        rows.append(mapped)
    checks={0x7efd12c:('ldr','x25, [x19, #0x20]'),0x7efd62c:('add','x8, sp, #0x20'),
      0x7efd630:('bl','#0x7efe28c'),0x7efd63c:('mov','w2, #0x48'),
      0x7efe2c0:('mov','x19, x8'),0x7efdca4:('str','w8, [x25, #0x20]'),
      0x7efdcbc:('str','w8, [x25, #0x24]'),0x7efdcd4:('str','w8, [x25, #0x28]'),
      0x7efdcec:('str','w8, [x25, #0x2c]'),0x7efdd6c:('str','w9, [x19]'),
      0x7efe5b4:('bl','#0x911ce38'),0x7efe66c:('bl','#0x91275b4'),
      0x96b31b4:('bl','#0x635bdcc'), # selected indexes: Buffer.ToArray allocates Il2CppArray
      0x91275f0:('bl','#0x635bf78'), # turn logs: ToList allocates an object
      0xa916d34:('str','wzr, [x19, #0x18]')} # List constructor count
    md=Cs(CS_ARCH_ARM64,CS_MODE_LITTLE_ENDIAN);instructions=[]
    for addr,expected in checks.items():
        ins=next(md.disasm(elf[image.offset(addr):image.offset(addr)+4],addr))
        assert (ins.mnemonic,ins.op_str)==expected,(hex(addr),ins.mnemonic,ins.op_str,expected)
        instructions.append({'rva':hex(addr),'instruction':ins.mnemonic+' '+ins.op_str})
    return {'buildId':BUILD_ID,'methods':rows,'fields':fields,'instanceSizes':sizes,'instructions':instructions,
       'selectedIndexesConcreteType':'int32[]','turnLogsConcreteType':'List<ExamSaveTurnLog>',
       'nullableResultBytes':72,'onDeviceVerified':False}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--elf',type=Path,required=True);p.add_argument('--metadata',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();a.output.write_text(json.dumps(verify(a.elf.read_bytes(),a.metadata.read_bytes()),indent=2)+'\n')
