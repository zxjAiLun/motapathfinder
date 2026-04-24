main.floors.MT320=
{
    "floorId": "MT320",
    "title": "320 层",
    "name": "320 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "03.png",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 1000000,
    "defaultGround": 976,
    "bgm": "19.mp3",
    "firstArrive": [
        {
            "type": "changePos",
            "direction": "down"
        },
        "\t[纳可]拦住去路的这些家伙是……\n【心魔】吗。",
        "\t[纳可]心魔，是由人心灵深处的恐惧，所滋生的东西……\n它们没有感情和理智存在，\n只会吞噬掉眼前所见到的一切。",
        "\t[纳可]游荡在幻境各处的心魔，\n前面居然一次出现四只。\n……之前都没有遇到过这么强大的敌人呢。",
        "\t[纳可]也就是说，我很可能已经抵达了终点。\n只要解决掉它们，就能冲出幻境！",
        {
            "type": "animate",
            "name": "wuyu",
            "loc": "hero"
        },
        "\t[纳可]怎么回事，过去的记忆突然涌现出来。\n地下宫殿，黑暗森林，\n天外来客的飞船……一次又一次的惊险。",
        "\t[纳可]以及，结识峰大哥，目睹他的神秘与强大，\n感受到的一丝落差与惶恐。",
        "\t[纳可]我真的能，成为和他一样的强者吗？",
        {
            "type": "animate",
            "name": "jingya",
            "loc": [
                11,
                2
            ]
        },
        "\t[纳可]等等，我在干什么，现在不是想这些的时候！",
        "\t[纳可]呼……峰大哥留下的灵魂印记唤醒了我。\n不然的话，恐怕我会不知不觉，\n陷入幻境的陷阱之中。",
        "\t[纳可]果然，近距离接触到这些心魔，\n没来由地就会升起杂念，感到惧怕，\n可这里不能退缩！",
        "\t[纳可]源自心中的恐惧——\n既然想要阻止我继续前进，\n那你们……就来吧。"
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,6": {
            "trigger": "action",
            "enable": true,
            "noPass": null,
            "displayDamage": true,
            "opacity": 1,
            "filter": {
                "blur": 0,
                "hue": 0,
                "grayscale": 0,
                "invert": false,
                "shadow": 0
            },
            "data": [
                {
                    "type": "if",
                    "condition": "(flag:321f==0)",
                    "true": [
                        {
                            "type": "setCurtain",
                            "color": [
                                0,
                                0,
                                0,
                                1
                            ],
                            "time": 1000,
                            "keep": true
                        },
                        "随着周围的彩色光华逐渐散去，\n纳可明白，至今为止，\n长达两年多的此行，即将接近尾声。",
                        "这段时间，她经历了很多事情。\n与纳家先祖纳鹰一样，\n名为左阿的强者，也拥有一段深刻的过往。",
                        "他们的故事，在纳可成长的途中，\n留下了难以磨灭的印象，\n这种影响，将伴随她走过漫长的强者之路。",
                        "水牢之中两年有余的光景，\n外界不过半年时间。\n可自己如今的实力，已然有了天翻地覆的变化。",
                        "纳可的实力，已然接近云霄级，\n在燕岗领也属于上层强者地位！",
                        "她丝毫不怀疑，姐姐纳娜米，\n也能够顺利通过幻境，\n并达到天空级后期的程度。",
                        "不知道再见神秘强者峰时，\n对方是不是也会对这般进境感到惊讶呢？",
                        "纳可这样想着，而此时此刻，\n眼前的彩色光华已然完全褪去。",
                        {
                            "type": "setValue",
                            "name": "flag:321f",
                            "value": "1"
                        },
                        {
                            "type": "changeFloor",
                            "floorId": "MT321",
                            "loc": [
                                6,
                                6
                            ],
                            "direction": "down"
                        }
                    ],
                    "false": [
                        {
                            "type": "changeFloor",
                            "floorId": "MT321",
                            "loc": [
                                6,
                                6
                            ],
                            "direction": "down"
                        }
                    ]
                }
            ]
        }
    },
    "changeFloor": {
        "11,1": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,2": [
            {
                "type": "setValue",
                "name": "flag:door_MT320_6_5",
                "operator": "+=",
                "value": "1"
            }
        ],
        "2,6": [
            {
                "type": "setValue",
                "name": "flag:door_MT320_6_5",
                "operator": "+=",
                "value": "1"
            }
        ],
        "10,6": [
            {
                "type": "setValue",
                "name": "flag:door_MT320_6_5",
                "operator": "+=",
                "value": "1"
            }
        ],
        "6,10": [
            {
                "type": "setValue",
                "name": "flag:door_MT320_6_5",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,5": {
            "0": {
                "condition": "flag:door_MT320_6_5==4",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT320_6_5",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            },
            "1": null
        },
        "5,6": {
            "0": {
                "condition": "flag:door_MT320_6_5==4",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT320_6_5",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "7,6": {
            "0": {
                "condition": "flag:door_MT320_6_5==4",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT320_6_5",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        },
        "6,7": {
            "0": {
                "condition": "flag:door_MT320_6_5==4",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_MT320_6_5",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [160,160,160,160,160,  0,620,  0,160,160,160,160,160],
    [160,160,160,160,  0,  0,  0,  0,  0,160,160, 88,160],
    [160,160,160, 47,  0,  0,1091,  0,  0, 50,160,160,160],
    [160,160,  0,  0,  0,  0,  0,  0,  0,  0,  0,160,160],
    [160,  0,  0,  0,621,  0,  0,  0,621,  0,  0,  0,160],
    [  0,  0,  0,  0,  0,  0, 85,  0,  0,  0,  0,  0,  0],
    [620,  0,1091,  0,  0, 85, 87, 85,  0,  0,1091,  0,620],
    [  0,  0,  0,  0,  0,  0, 85,  0,  0,  0,  0,  0,  0],
    [160,  0,  0,  0,621,  0,  0,  0,621,  0,  0,  0,160],
    [160,160,  0,  0,  0,  0,  0,  0,  0,  0,  0,160,160],
    [160,160,160, 50,  0,  0,1091,  0,  0, 47,160,160,160],
    [160,160,160,160,  0,  0,  0,  0,  0,160,160,160,160],
    [160,160,160,160,160,  0,620,  0,160,160,160,160,160]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}