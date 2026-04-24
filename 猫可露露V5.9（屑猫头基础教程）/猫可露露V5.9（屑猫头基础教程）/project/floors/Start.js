main.floors.Start=
{
    "floorId": "Start",
    "title": "O 层",
    "name": "O 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": "ground",
    "firstArrive": [
        {
            "type": "showStatusBar"
        },
        {
            "type": "setValue",
            "name": "item:book",
            "value": "1"
        },
        {
            "type": "setValue",
            "name": "item:fly",
            "value": "1"
        },
        {
            "type": "setValue",
            "name": "flag:shop1",
            "value": "1"
        },
        {
            "type": "setText",
            "align": "left",
            "background": "winskin.png",
            "lineHeight": 22
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,0": [
            {
                "type": "choices",
                "choices": [
                    {
                        "text": "开始游戏",
                        "color": [
                            221,
                            201,
                            93,
                            1
                        ],
                        "action": [
                            "太初之时，诞有一方大陆名为血洛。\n血洛大陆能量充盈，孕育出诸多种族与生命。\n万族共生，弱肉强食。",
                            "历经亿亿载岁月，万族以兽神为首，\n建立起绵延悠久的，混乱与稳定并存的秩序。\n可惜，万事万物，有生，就有灭。",
                            "在血洛大陆步入文明时期的二百七十万亿年之后，\n强横恐怖的天外族群降临，\n欲要与血洛万族争夺生存空间。",
                            "为了延续种族血脉，\n兽神带领着血洛大陆的土著神明，\n与天外族群进行了三百万年惨烈的战争。",
                            "天地大劫，诸神黄昏。\n最终，伟大的兽神及诸多神明以生命为代价，\n打退了天外族群，挽救血洛大陆于水火之中。",
                            "大劫过后，仅存的神灵们建立起不朽神殿，\n缔造了新的秩序。\n直至今日。",
                            "血洛万族仍铭记着神灵的教诲，\n他们以力量为尊，崇尚强者之道。\n在这方大陆，强者，可以肆意将无数弱者踩在脚下！",
                            "血洛修炼者们根据实力强弱，\n将力量层次划分为微尘、万物、潮汐、大地等级别。",
                            "微尘级，最弱势的群体，体质虚弱。\n万物级，力壮如牛，胆气如虎。\n潮汐级，感应元素，神力千钧……",
                            "万族生灵之中，\n为走上强者之路而勤奋刻苦，且具有天资者，\n在成长阶段，便足以跨越前三个层次！",
                            "在这之上——\r[#75E97E]大地级\r，\n则为公认的修炼者第一个大门槛。\n越过这个门槛，方可仗剑行走大陆，再无温饱之忧。",
                            "纳可，燕岗城纳家一个平平无奇的小丫头。\n纳家虽然只是一个世代从商的家族，\n但毕竟生活在崇尚武力的世界，也有数位强者坐镇。",
                            "这一天，当纳可刚结束了早上的修行，\n却发现和自己一同长大的姐姐纳娜米不见了。",
                            "纳娜米从小就喜欢纳可跟在她身边，不管去哪里都会带着她。\n纳可很担忧姐姐的安全，便四处寻找起来。",
                            "当从家族中得知，纳娜米昨天外出历练，至今未回时，纳可已经顾不上思考。\n她决然地独自一人离开家族，寻找纳娜米的踪迹。",
                            "我们的故事，就从这里开始…",
                            {
                                "type": "openDoor",
                                "loc": [
                                    6,
                                    10
                                ]
                            }
                        ]
                    },
                    {
                        "text": "回放录像",
                        "color": [
                            211,
                            103,
                            139,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\ncore.control.checkBgm()\n}"
                            },
                            {
                                "type": "if",
                                "condition": "(!core.isReplaying())",
                                "true": [
                                    {
                                        "type": "function",
                                        "function": "function(){\ncore.chooseReplayFile()\n}"
                                    }
                                ],
                                "false": []
                            }
                        ]
                    },
                    {
                        "text": "纳可的心境",
                        "color": [
                            155,
                            235,
                            227,
                            1
                        ],
                        "condition": "item:I954==0",
                        "action": [
                            {
                                "type": "insert",
                                "loc": [
                                    6,
                                    5
                                ],
                                "floorId": "sample0"
                            }
                        ]
                    },
                    {
                        "text": "跳关选项",
                        "color": [
                            223,
                            235,
                            155,
                            1
                        ],
                        "condition": "item:I954==0",
                        "action": [
                            {
                                "type": "insert",
                                "loc": [
                                    6,
                                    4
                                ],
                                "floorId": "sample0"
                            }
                        ]
                    },
                    {
                        "text": "幸运计分",
                        "color": [
                            121,
                            219,
                            168,
                            1
                        ],
                        "condition": "item:I954==0",
                        "action": [
                            "计分方式为你当前拥有的幸运字符数量！\n当本塔完结时，如果你集齐了全部的幸运字符，\n有机会解锁一些额外的独立关卡……？",
                            {
                                "type": "if",
                                "condition": "(item:I1025+item:I1026+item:I1027+item:I1028+item:I1029+item:I1030+item:I1031+item:I1032+item:I1033+item:I1034+item:I1128+item:I1129+item:I1130+item:I1131+item:I1132+item:I1133+item:I1134+item:I1135+item:I1136+item:I1137+item:I1138+item:I1139+item:I1140+item:I1141+item:I1142+item:I1143+item:I1144+item:I1145+item:I1427+item:I1428+item:I1429+item:I1430+item:I1478+item:I1479+item:I1480+item:I1481+item:I1482+item:I1483+item:I1484+item:I1485==0)",
                                "true": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "operator": "/=",
                                        "value": "status:hp*2"
                                    }
                                ],
                                "false": [
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "value": "item:I1025+item:I1026+item:I1027+item:I1028+item:I1029+item:I1030+item:I1031+item:I1032+item:I1033+item:I1034+item:I1128+item:I1129+item:I1130+item:I1131+item:I1132+item:I1133+item:I1134+item:I1135+item:I1136+item:I1137+item:I1138+item:I1139+item:I1140+item:I1141+item:I1142+item:I1143+item:I1144+item:I1145+item:I1427+item:I1428+item:I1429+item:I1430+item:I1478+item:I1479+item:I1480+item:I1481+item:I1482+item:I1483+item:I1484+item:I1485"
                                    }
                                ]
                            },
                            {
                                "type": "win",
                                "reason": "天选之人"
                            }
                        ]
                    },
                    {
                        "text": "CG展览馆",
                        "color": [
                            121,
                            167,
                            219,
                            1
                        ],
                        "_collapsed": true,
                        "action": [
                            {
                                "type": "choices",
                                "text": "这里是CG展览馆，\n展示了游戏中的部分场景。\n请选择角色！",
                                "choices": [
                                    {
                                        "text": "纳可",
                                        "color": [
                                            238,
                                            231,
                                            128,
                                            1
                                        ],
                                        "action": [
                                            {
                                                "type": "choices",
                                                "text": "请选择要看的CG。",
                                                "choices": [
                                                    {
                                                        "text": "纳可（初始）",
                                                        "color": [
                                                            238,
                                                            231,
                                                            128,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nake1.jpg",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    0,
                                                                    -60,
                                                                    416,
                                                                    600
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳可（JS）",
                                                        "color": [
                                                            238,
                                                            231,
                                                            128,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nake2.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    0,
                                                                    0,
                                                                    416,
                                                                    470
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳可（雌小鬼）",
                                                        "color": [
                                                            238,
                                                            231,
                                                            128,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nake3.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    0,
                                                                    -50,
                                                                    416,
                                                                    470
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳可（火焰领域）",
                                                        "color": [
                                                            238,
                                                            231,
                                                            128,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nake4.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    -100,
                                                                    0,
                                                                    600,
                                                                    416
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳可（雪原）",
                                                        "color": [
                                                            238,
                                                            231,
                                                            128,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nake5.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    -100,
                                                                    0,
                                                                    600,
                                                                    416
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳可（幻境）",
                                                        "color": [
                                                            238,
                                                            231,
                                                            128,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nake6.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    -25,
                                                                    0,
                                                                    450,
                                                                    416
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "insert",
                                                "loc": [
                                                    6,
                                                    0
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        "text": "纳娜米",
                                        "color": [
                                            194,
                                            121,
                                            226,
                                            1
                                        ],
                                        "action": [
                                            {
                                                "type": "choices",
                                                "text": "请选择要看的CG。",
                                                "choices": [
                                                    {
                                                        "text": "纳娜米（初始）",
                                                        "color": [
                                                            194,
                                                            121,
                                                            226,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nanami1.jpg",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    -50,
                                                                    0,
                                                                    480,
                                                                    480
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳娜米（圣诞前夜）",
                                                        "color": [
                                                            194,
                                                            121,
                                                            226,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nanami2.jpg",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    0,
                                                                    0,
                                                                    480,
                                                                    450
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳娜米（短发）",
                                                        "color": [
                                                            194,
                                                            121,
                                                            226,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nanami3.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    0,
                                                                    -50,
                                                                    430,
                                                                    470
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳娜米（女仆）",
                                                        "color": [
                                                            194,
                                                            121,
                                                            226,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nanami4.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    0,
                                                                    0,
                                                                    416,
                                                                    440
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "纳娜米（魔女）",
                                                        "color": [
                                                            194,
                                                            121,
                                                            226,
                                                            1
                                                        ],
                                                        "action": [
                                                            {
                                                                "type": "showImage",
                                                                "code": 1,
                                                                "image": "nanami5.png",
                                                                "sloc": [
                                                                    0,
                                                                    0,
                                                                    null
                                                                ],
                                                                "loc": [
                                                                    -100,
                                                                    0,
                                                                    640,
                                                                    470
                                                                ],
                                                                "opacity": 1,
                                                                "time": 1000
                                                            },
                                                            {
                                                                "type": "wait",
                                                                "forceChild": true,
                                                                "_collapsed": true,
                                                                "data": [
                                                                    {
                                                                        "case": "keyboard",
                                                                        "keycode": "13,32",
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当按下回车(keycode=13)或空格(keycode=32)时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    },
                                                                    {
                                                                        "case": "mouse",
                                                                        "px": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "py": [
                                                                            0,
                                                                            416
                                                                        ],
                                                                        "action": [
                                                                            {
                                                                                "type": "hideImage",
                                                                                "code": 1,
                                                                                "time": 1000
                                                                            },
                                                                            {
                                                                                "type": "comment",
                                                                                "text": "当点击地图左上角时执行此事件\n超时剩余时间会写入flag:timeout"
                                                                            }
                                                                        ]
                                                                    }
                                                                ]
                                                            }
                                                        ]
                                                    }
                                                ]
                                            },
                                            {
                                                "type": "insert",
                                                "loc": [
                                                    6,
                                                    0
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "text": "退出选择",
                        "action": []
                    }
                ]
            }
        ],
        "4,9": [
            {
                "type": "choices",
                "text": "\t[千夜,E716]如果你喜欢本作，\n可以关注我的B站账号：\r[yellow]幼年猫妖\r，以第一时间获取更新信息。\n也可以加入讨论群\r[yellow]947190984\r，与作者和其他玩家交流讨论。\n每一份这样的支持都可以为作者提供更多的精神动力。",
                "choices": [
                    {
                        "text": "作者的个人主页",
                        "action": [
                            {
                                "type": "function",
                                "function": "function(){\nwindow.open(\"https://space.bilibili.com/13853635?spm_id_from=333.1007.0.0\")\n}"
                            }
                        ]
                    },
                    {
                        "text": "作者的更多作品",
                        "action": [
                            {
                                "type": "choices",
                                "text": "\t[千夜,E716]B站账号：\r[yellow]幼年猫妖\r\n讨论群：\r[yellow]947190984\r",
                                "choices": [
                                    {
                                        "text": "星之葬",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Star/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "花之伤",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Flower/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "时盘乐园",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Time/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "完美生命",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Perfect/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "殉道者",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Martyr/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "空白",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Blank/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "纯黑",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Black/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "纸船效应",
                                        "action": [
                                            {
                                                "type": "function",
                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Boat/\")\n}"
                                            }
                                        ]
                                    },
                                    {
                                        "text": "下一页",
                                        "action": [
                                            {
                                                "type": "choices",
                                                "text": "\t[千夜,E716]B站账号：\r[yellow]幼年猫妖\r\n讨论群：\r[yellow]947190984\r",
                                                "choices": [
                                                    {
                                                        "text": "夜花吟",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Night/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "潮汐之囚",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Sea/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "光风霁月 ~ 晴之章",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/ToWish/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "花与泪的瞬间",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Forever/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "萤之盲",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Blind/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "夕之降",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/Decline/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "吃小雨",
                                                        "action": [
                                                            {
                                                                "type": "function",
                                                                "function": "function(){\nwindow.open(\"https://h5mota.com/games/xiaoyu/\")\n}"
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "返回上一页",
                                                        "action": [
                                                            {
                                                                "type": "insert",
                                                                "loc": [
                                                                    4,
                                                                    9
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    {
                                                        "text": "退出选项",
                                                        "action": []
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "text": "退出选项",
                        "action": []
                    }
                ]
            }
        ],
        "8,9": [
            {
                "type": "choices",
                "text": "游戏介绍。",
                "choices": [
                    {
                        "text": "故事背景",
                        "action": [
                            {
                                "type": "playSound",
                                "name": "打开界面"
                            },
                            "\\i[I1178]背景取材自\\i[I1176]\r[orange]《吞噬星空》血洛世界\r部分。\n你将与可爱的少女\\i[E1650]\r[yellow]纳可\r同行，\n领略血洛大陆的繁华、壮阔，\n见识血洛修行者们的强大、凶残与狡诈。\n\n\\i[I1176]\r[yellow]《纳可物语》\r为原作小说《吞噬星空》的\r[lime]同人塔\r。\n故事剧情除开\r[#66CCFF]与原作接轨的部分\r之外，\n其他故事情节，系塔作者原创，\n绝大多数情节\r[lime]并未在原作小说中出现过\r。\n\n且\r[#66CCFF]根据魔塔游戏的需要，存在与原作不同的改动\r。\n如有与原作冲突之处，请\r[yellow]以原作为准\r，\n或将其当作\r[lime]平行世界\r来看待。\n话不多说，就让我们开始体验游戏吧。"
                        ]
                    },
                    {
                        "text": "绿钥匙",
                        "action": [
                            "\\i[greenKey]一种具备神奇力量的钥匙，\n能够\r[lime]打开绿色的门\\i[greenDoor]\r。\n注意：绿钥匙\r[lime]仅提供给游戏外的玩家，故事中的角色是看不到它的\r。\n你在每个区域的开头，都将\r[#66CCFF]得到一定数量的绿钥匙，并为你提供有一定数量的绿门\r。\n比如现在，你已经拿到\r[aqua]4把绿钥匙\r了吧？\n\n\\i[I902]游戏难度与绿钥匙使用数量成\r[gold]反比\r。\n你可以利用它来\r[#66CCFF]自由调控游戏的难度\r，\n使用的绿钥匙\r[#76dead]越多\r，游戏往往也就变得\r[#76dead]越简单\r。\n\n\\i[I596]以研究为目的的玩家，\n请以\r[gold]保留尽可能多的绿钥匙\r为目标努力吧。\n\n当然，\r[#7edb4f]不同的计分点有不同的要求，\n部分计分点的高分路线，与绿钥匙关联不大，但也有同样的研究价值！\r"
                        ]
                    },
                    {
                        "text": "第几幕",
                        "action": [
                            "\\i[I602]记录着你当前的\r[yellow]剧情进程\r。\n你每通过游戏的一幕，\n\r[#66CCFF]故事发生的场景\r都会有一定变化。\n你将\r[yellow]与不同的好友一起行动，共同探险，或是面对不同的敌人\r。\n\n\\i[fly]每一幕结束之后，都将提供三个计分点，\n即：\n\r[#66CCFF]天之门（绿钥匙）\r\\i[I570]、\n\r[lime]生之门（生命）\r\\i[I1169]、\n\r[gold]匙之门（道具）\r\\i[I1471]。\n在\r[pink]第五幕\r之后，\n第四个计分点\r[#e1a0e8]灵之门（领悟）\\i[I1448]\r将会出现。",
                            "在\r[#66CCFF]【天之门】\r中，一把绿钥匙计为\r[#8ab5f2]100兆\r分数，\n因此\r[#8ab5f2]成绩的排头数字将代表你的绿钥匙数量\r。\n你保留下的\\i[I902]\r[lime]绿钥匙\r越多，对于分数就越有利。\n\n\r[lime]【生之门】\r与你当前生命\r[lime]正相关\r。\n\r[gold]【匙之门】\r则只看持有的\r[gold]道具数量\r。\n权值为：\r[yellow]\\i[yellowKey]黄钥匙1、\\i[blueKey]蓝钥匙3、\n\\i[redKey]红钥匙/\\i[pickaxe]破墙镐/\\i[centerFly]飞行器10、\n\\i[I732]磁吸石/\\i[I733]换位标靶20、\\i[greenKey]绿钥匙25\r。\n\n\r[#e1a0e8]【灵之门】\r同时牵涉到领悟与绿钥匙，\n将计为\r[#dbb6ed]所余领悟点数与绿钥匙数量的\r[pink]乘积\r\r。\n\n\r[#b6d9bf]每幕结束时，建议在计分点提交成绩，再继续游戏。\n已登录的用户，可在个人中心下载自己提交的录像，防止超长的游戏流程导致存档丢失。"
                        ]
                    },
                    {
                        "text": "纳可心境",
                        "action": [
                            "你对\r[#f2a7b7]\\i[I837]高难度的挑战\r感兴趣吗？\n啊，不必紧张，不管回答是或否，\n喵都会向你推荐游玩\r[lime]【纳可的心境】\r。\n\n\\i[I1182]它包含了很多个\r[#88c4de]独立于游戏外的挑战副本\r，\n服务于\r[#f5d358]不满足原作难度，希望挑战自我的玩家\r。\n进入每一个心境后，角色\r[yellow]状态重置为特定值\r。\n你将在心境中完成一个个\r[#f2a7b7]流程较短，\n但难度极高\r的挑战。\n\n\\i[I1418]这\r[aqua]并非代表一般玩家无法尝试\r。\n在\r[#e3d5b8]第二心境及之后的心境\r，当你遇到困难时，\n你可以\r[#66CCFF]使用背包中的\\i[I1187]心境之石求援\r——\n\r[lime]使用你的分数\r来换取过关资源！",
                            "\\i[I1135]第一次使用\\i[I1187]心境之石，分数变为\r[gold]1/1000\r。\n此后每次使用，都变为前一次的\r[gold]1/100\r。\n\n\\i[I1176]当新的游戏篇章更新后，对应的心境将会同步开启。\n心境中取得的成绩将\r[lime]单独记录榜单，\n与你通关所剩的生命正相关\r。\n\n\r[#f2a7b7]\\i[I1455]当你决定不使用任何一颗心境之石\r时，\n你将直面心境最深处的恐惧，此时通关的门槛，\n\r[yellow]足以将绝大多数玩家拦截在外\r！\n\n\r[gold]——也许你是一个例外呢？\n前进吧，勇士！\r"
                        ]
                    }
                ]
            }
        ],
        "7,11": [
            "【额外模式】\n暂未开放。"
        ],
        "5,11": [
            {
                "type": "if",
                "condition": "(item:I954==0)",
                "true": [
                    {
                        "type": "choices",
                        "text": "『新手教程』——\n服务于刚刚接触魔塔的新人，\n或对游戏隐藏机制尚存有信息盲区的玩家。\n请注意，进入新手教程之后不可返回，\n可留下存档之后再进入。",
                        "choices": [
                            {
                                "text": "基础教程",
                                "color": [
                                    159,
                                    243,
                                    182,
                                    1
                                ],
                                "action": [
                                    {
                                        "type": "insert",
                                        "name": "清空状态"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:exp",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:lv",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "value": "100"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:atk",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:def",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:mdef",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:yellowKey",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:blueKey",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:redKey",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:greenKey",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:pickaxe",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:centerFly",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:bomb",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:I1182",
                                        "value": "1"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "JC1",
                                        "loc": [
                                            6,
                                            11
                                        ],
                                        "direction": "up"
                                    }
                                ]
                            },
                            {
                                "text": "进阶教程",
                                "color": [
                                    236,
                                    201,
                                    168,
                                    1
                                ],
                                "action": [
                                    {
                                        "type": "insert",
                                        "name": "清空状态"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:exp",
                                        "value": "0"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:lv",
                                        "value": "12"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:hp",
                                        "value": "6000000"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:atk",
                                        "value": "48000"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:def",
                                        "value": "48000"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "status:mdef",
                                        "value": "330000"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:yellowKey",
                                        "value": "6"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:blueKey",
                                        "value": "3"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:redKey",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:pickaxe",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:centerFly",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:bomb",
                                        "value": "0"
                                    },
                                    {
                                        "type": "changeFloor",
                                        "floorId": "B1",
                                        "loc": [
                                            6,
                                            6
                                        ],
                                        "direction": "down"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:I898",
                                        "value": "1"
                                    },
                                    {
                                        "type": "setValue",
                                        "name": "item:I928",
                                        "value": "1"
                                    },
                                    {
                                        "type": "loadEquip",
                                        "id": "I898"
                                    },
                                    {
                                        "type": "loadEquip",
                                        "id": "I928"
                                    }
                                ]
                            },
                            {
                                "text": "离去…",
                                "action": []
                            }
                        ]
                    }
                ],
                "false": [
                    "为什么都玩到这么靠后的位置了，\n又回来打教程！\n还是重开一个存档打叭。"
                ]
            }
        ]
    },
    "changeFloor": {
        "6,12": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  1,  1,  1,  1,  1,  1,102,  1,  1,  1,  1,  1,  1],
    [  1,  1,  1,  1,  1,  1,  0,  1,  1,  1,  1,  1,  1],
    [  1, 33,586, 27, 28, 84,  0, 84, 23, 31, 32, 34,  1],
    [  1,  1,  1,  1,  1,  1,600,  1,  1,  1,  1,  1,  1],
    [  1,  1,  1,  1,  1,  1,  0,  1,  1,  1,  1,  1,  1],
    [  1,893, 84, 84, 84, 84, 24, 84, 84, 30, 34, 30,  1],
    [  1,  1,  1,  1,  1,  1, 24,  1,  1,  1,  1,  1,  1],
    [10186,  1,10187,  1,  1,  1, 24,  1,  1,  1, 17,  1, 17],
    [ 31,  1, 32,  1,  0, 86, 24, 86,  0,  1, 27,  1, 28],
    [  1,  1,  1,  1,891,  1,  0,  1,80169,  1,  1,  1,  1],
    [10189,  1,10196,  1,  1,  1, 85,  1,  1,  1, 17,  1,10248],
    [ 34,  1, 33,  1,  1,102,  0,102,  1,  1, 29,  1, 30],
    [  1,  1,  1,  1,  1,  1, 87,  1,  1,  1,  1,  1,  1]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,101,  0,101,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,629,  0,793],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,803,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

],
    "bgm": null,
    "weather": null
}