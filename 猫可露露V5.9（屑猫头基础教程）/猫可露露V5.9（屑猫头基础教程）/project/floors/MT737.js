main.floors.MT737=
{
    "floorId": "MT737",
    "title": "737 层",
    "name": "737 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 5000000000000,
    "defaultGround": 470002,
    "bgm": "39.mp3",
    "weather": [
        "snow",
        1
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "5,6": {
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
            "data": []
        },
        "7,6": {
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
            "data": []
        },
        "11,7": {
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
            "data": []
        },
        "9,11": {
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
            "data": []
        },
        "12,12": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得20把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:737f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:737f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得10把绿钥匙、5000领悟",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:737f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "10"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "operator": "+=",
                                "value": "5000"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:737f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "10"
                            }
                        ]
                    },
                    {
                        "text": "获得10000领悟",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:737f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "status:money",
                                "operator": "+=",
                                "value": "10000"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:737f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "20"
                            }
                        ]
                    },
                    {
                        "text": "离去…",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "11,11": {
            "floorId": ":next",
            "stair": "downFloor"
        },
        "0,8": {
            "floorId": ":before",
            "stair": "upFloor"
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
    [470179,470180,470181,470182,470183,470140,470141,470142,470179,470180,470181,470182,470183],
    [470187,470188,470189,470190,470191,470148,470149,470150,470187,470188,470189,470190,470191],
    [470195,470196,470197,470198,470199,470156,470157,470158,470195,470196,470197,470198,470199],
    [470203,470204,470205,470206,470207,470164,470165,470166,470203,470204,470205,470206,470207],
    [470211,470212,470213,470214,470215,470172,470173,470174,470211,470212,470213,470214,470215],
    [470219,470220,470221,470222,470223,  0,  0,  0,470219,470220,470221,470222,470223],
    [470227,470228,470229,470230,470231,1830,  0,1831,470227,470228,470229,470230,470231],
    [470255,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,1832,470255],
    [ 88,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,668],
    [470721,470722,470723, 83,470768,470769,470770,470771,470772,  0,470888,470889,470890],
    [470729,470730,470731,1007,470776,470777,470778,470779,470780,  0,  0,  0,  0],
    [470737,470738,470739, 83,470784,470785,470786,470787,470788,1833,  0, 87,  0],
    [470745,470746,470747,1007,470792,470793,470794,470795,470796,  0,  0,  0,985]
],
    "bgmap": [

],
    "fgmap": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [470239,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,470239],
    [470247,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,470247],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}