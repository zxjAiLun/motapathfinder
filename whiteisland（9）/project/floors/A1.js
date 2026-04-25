main.floors.A1=
{
    "floorId": "A1",
    "title": "试炼间",
    "name": "试炼间",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 1,
    "defaultGround": 80020,
    "bgm": "1.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "6,12": [
            {
                "type": "choices",
                "text": "可以选择在这里降低难度。\n你将得到10%伤害减免，以及本区域额外福利：\n300生命，2黄钥匙，1蓝钥匙。",
                "choices": [
                    {
                        "text": "降低难度",
                        "color": [
                            0,
                            255,
                            125,
                            1
                        ],
                        "action": [
                            {
                                "type": "setValue",
                                "name": "item:I582",
                                "value": "1"
                            },
                            {
                                "type": "setValue",
                                "name": "status:hp",
                                "operator": "+=",
                                "value": "300"
                            },
                            {
                                "type": "setValue",
                                "name": "item:yellowKey",
                                "operator": "+=",
                                "value": "2"
                            },
                            {
                                "type": "setValue",
                                "name": "item:blueKey",
                                "operator": "+=",
                                "value": "1"
                            },
                            {
                                "type": "hide",
                                "remove": true
                            }
                        ]
                    },
                    {
                        "text": "取消",
                        "action": []
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "11,2": {
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
    [140,140,140,140,140,140,140,140,140,140,140,140,140],
    [140,140, 32,140, 31,  0,203,  0, 28,204, 29,140,140],
    [140, 31,  0,202,  0,202,140, 21,  0,140,  0, 87,140],
    [140,201,140,140,140, 81,140,140,140,140, 28,  0,140],
    [140,  0,140,140, 31,204, 29,  0, 31,140,140,206,140],
    [140, 21,140, 27,210,140,  0, 28,  0, 81, 21,  0,140],
    [140,201,140,140,  0,140,140,206,140,140,  0, 29,140],
    [140,  0, 29,140,202,140,140,  0, 31,203, 32,  0,140],
    [140, 31,  0,201,  0, 81,  0, 21,  0,140,201,140,140],
    [140,140,208,140,140,140,201,140,140,140,  0, 27,140],
    [140, 31,  0, 32,140, 21,  0, 22,140,  0,202,140,140],
    [140,  0, 27,  0,140,  0,  0,  0, 82, 28,  0,140,140],
    [140,140,140,140,140,140, 89,140,140,140,140,140,140]
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