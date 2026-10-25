/** Static syntax probes, shared by unit, runtime and distributed artifact checks. */
export const syntaxFixtures:[string,string,string,number][]=[
 ['js','import {\n x\n} from "library";','library',3],['jsx','import React from "react";','react',1],
 ['ts','export type { A } from "types";','types',1],['tsx','import React from "react"; const el=<div/>;','react',1],
 ['py','from fastapi import (\n FastAPI,\n)','fastapi',1],['java','package app;\nimport java.util.List;\nclass A{}','java.util.List',2],
 ['go','package main\nimport (\n "example.com/lib"\n)','example.com/lib',3],['rs','use serde::{Serialize, Deserialize};','serde::Serialize',1],
 ['rb','require_relative "helper"','helper',1],['php','<?php\nuse Other\\Thing;','Other\\Thing',2],
 ['cs','using System.Text;\nclass A{}','System.Text',1],['fs','open System.Text\nlet x=1','System.Text',1],
 ['c','#include "local.h"','local.h',1],['h','#include <stdio.h>','stdio.h',1],['cpp','#include <vector>','vector',1],
 ['swift','import Foundation','Foundation',1],['kt','package app\nimport kotlin.collections.List','kotlin.collections.List',2],
 ['kts','import kotlin.collections.List','kotlin.collections.List',1],['scala','import scala.collection.{List, Map}','scala.collection',1],
 ['vue','<script setup lang="ts">\nimport {ref} from "vue";\n</script><template>import fake from "bad";</template>','vue',2],
 ['svelte','<script>\nimport {writable} from "svelte/store";\n</script>','svelte/store',2],
 ['astro','---\nimport Widget from "./Widget.astro";\n---\n<div/>','./Widget.astro',2],
];
