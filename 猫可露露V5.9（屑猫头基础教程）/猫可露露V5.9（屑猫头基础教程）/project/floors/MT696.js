main.floors.MT696=
{
    "floorId": "MT696",
    "title": "696 层",
    "name": "696 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1000000000000,
    "defaultGround": 450256,
    "bgm": "37.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "12,9": [
            {
                "type": "choices",
                "text": "\t[绿色按钮,A985]如果觉得打不动的话，\n不妨来点补给再前进吧！\n又或者，如果你更喜欢绿钥匙……？",
                "choices": [
                    {
                        "text": "获得6把绿钥匙",
                        "color": [
                            75,
                            217,
                            63,
                            1
                        ],
                        "need": "flag:696f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "item:greenKey",
                                "operator": "+=",
                                "value": "6"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:696f",
                                "operator": "+=",
                                "value": "1"
                            }
                        ]
                    },
                    {
                        "text": "获得3把绿钥匙、4垓生命",
                        "color": [
                            118,
                            209,
                            125,
                            1
                        ],
                        "need": "flag:696f<1",
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
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "4e20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:696f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "3"
                            }
                        ]
                    },
                    {
                        "text": "获得8垓生命",
                        "color": [
                            167,
                            217,
                            167,
                            1
                        ],
                        "need": "flag:696f<1",
                        "action": [
                            {
                                "type": "animate",
                                "name": "green"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "8e20"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:696f",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "flag:saltygreen",
                                "operator": "+=",
                                "value": "6"
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
        "11,10": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,1": {
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
    [269,269,269,269,269,269,269,269,269,269,269,269,269],
    [269,269,269,269,269,  0,1438,  0,269,269,  0, 87,269],
    [269,269,269,269,642,1682,  0,1011,1687,642,1683,  0,269],
    [269,269, 50,269,269,644,269,269,269,269, 83,269,269],
    [269,646,  0,1688,  0,1684,269,269,269,269,1682,269,269],
    [269,  0,1685,269,269,  0,1012,1685,  0,644,  0, 21,269],
    [269,269, 16,269,269,1686,269,269,1684,269,269,1681,269],
    [269,269,  0,643,  0, 21,269,269, 21,269,269,1015,269],
    [269,269,269,269,1681,269,269,269,642,269,269,1684,269],
    [269,269,269,1685, 21,1684,1012,  0,1682, 21,269,  0,985],
    [269,269,269,1019,269,269, 81,450025, 81,269,269, 88,269],
    [269,1013,1683,  0, 81, 22,1683, 81, 22,269,269,269,269],
    [269,269,269,269,269,269,269,269,269,269,269,269,269]
],
    "bgmap": [

],
    "fgmap": [
    [284,284,284,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [284,284,284,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,450017,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [

],
    "fg2map": [

]
}