main.floors.MT758=
{
    "floorId": "MT758",
    "title": "758 层",
    "name": "758 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1897,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,11": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得8把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:758f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "8"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:758f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得4把绿钥匙、200塔中亡灵",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:758f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "3"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:wl",
                                "operator": "+=",
                                "value": "200"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:758f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "4"
                            }
                        ]
                    },
                    {
                        "text": "获得400塔中亡灵",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:758f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:wl",
                                "operator": "+=",
                                "value": "400"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:758f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "8"
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
        "1,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,11": {
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
    [1888,1888,1888,1888,1888,1888,1888,1888,1888,1888,1888,1888,1888],
    [1888,1015,644,1888, 21,736, 21,1888,  0,1888,1019,  0,1888],
    [1888,644,1012,1888,2070,1006,2070,1888,643, 81,1961,1019,1888],
    [1888,1962, 21,1888, 21, 22, 21,1888,  0,1888,1888,1888,1888],
    [1888, 81,1888,1888,1888, 16,1888,1888,1959,1888, 15,1012,1888],
    [1888, 21,  0,1961,  0,1015,  0,1957,  0, 15,1012, 15,1888],
    [1888, 81,1888,1888,643,  0,644,1888,644,1888,1888,1888,1888],
    [1888,1965, 21,1888,1888,1960,1888,1888,  0,1888,644,1012,1888],
    [1888,643,1012,1888,  0,1438,  0,1888,1015, 81,1962, 21,1888],
    [1888,1015,643,1888, 50,  0, 23,1888,  0,1888,1888,1888,1888],
    [1888,1888,1888,1888,1888,1962,1888,1888,1958,1888,2070,  0,1888],
    [1888, 88,  0, 47,  0,  0,985,1888,  0, 81,  0, 87,1888],
    [1888,1888,1888,1888,1888,1888,1888,1888,1888,1888,1888,1888,1888]
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